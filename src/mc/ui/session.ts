// Host menu screens for the sessions and the end of the race (spec §4): pause, ending and
// resuming a day, Team fixes, Status and End race. Each reads the world and dispatches.
import { world } from '@minecraft/server';
import { ModalFormData } from '@minecraft/server-ui';

import { showForm, showMenu } from './forms.js';
import { statusMenu } from '../../core/menu.js';
import { OVERWORLD } from '../race.js';

import type { Player } from '@minecraft/server';

import type { Menu } from '../../core/menu.js';
import type { Session } from '../../core/session.js';
import type { Action } from '../../core/types.js';
import type { Vec3 } from '../../core/vec.js';

type Fix = Extract<Action, { type: 'teamFix' }>['fix'];

const confirmMenu = (title: string, body: string, yes: string): Menu<'yes' | 'no'> => ({
  title,
  body,
  buttons: [{ command: 'yes', label: yes }, { command: 'no', label: 'Cancel' }],
});

const FIXES = ['Add penalty', 'Skip current step', 'Teleport me to team', 'Eliminate team'];

/** Where each online racer stands in the Overworld (one elsewhere has no position). */
function positions(session: Session): { id: string; pos?: Vec3 }[] {
  const ids = (session.state?.teams ?? []).flatMap((t) => t.members);
  return world.getPlayers().filter((p) => ids.includes(p.id)).map((p) => ({
    id: p.id,
    pos: p.dimension.id === OVERWORLD ? p.location : undefined,
  }));
}

export const pause = (session: Session, player: Player): void => {
  session.dispatch({ type: 'pauseRace', by: player.id });
};

export const unpause = (session: Session, player: Player): void => {
  session.dispatch({ type: 'unpauseRace', by: player.id });
};

export const resumeDay = (session: Session, player: Player): void => {
  session.dispatch({ type: 'resumeDay', by: player.id });
};

export async function endDay(session: Session, player: Player): Promise<void> {
  const menu = confirmMenu(
    'End day',
    'Racers\' positions and the time of day are saved. Resume the day in the next session.',
    'End day',
  );
  if (await showMenu(player, menu, session.log) !== 'yes') return;
  session.dispatch({ type: 'endDay', by: player.id, positions: positions(session) });
}

export async function endRace(session: Session, player: Player): Promise<void> {
  const menu = confirmMenu(
    'End race',
    'Husks are removed, the game rules and time of day go back, the sidebar is removed and '
      + 'everyone is set to Survival without a Passport. Arenas and terrain stay. '
      + 'This cannot be undone.',
    'End race',
  );
  if (await showMenu(player, menu, session.log) !== 'yes') return;
  session.dispatch({
    type: 'endRace', by: player.id, online: world.getPlayers().map((p) => p.id),
  });
}

export async function status(session: Session, player: Player): Promise<void> {
  const { state } = session;
  if (!state) return;
  await showMenu(player, statusMenu(state, world.getPlayers().map((p) => p.id)), session.log);
}

/** The online member of the team nearest to the host, where they stand (the host goes there). */
function memberPos(session: Session, teamId: string, host: Player): Vec3 | undefined {
  const team = session.state?.teams.find((t) => t.id === teamId);
  const dist = (p: Player): number => (host.dimension.id === OVERWORLD
    ? (p.location.x - host.location.x) ** 2 + (p.location.z - host.location.z) ** 2 : 0);
  const [mate] = world.getPlayers()
    .filter((p) => team?.members.includes(p.id) && p.dimension.id === OVERWORLD)
    .sort((x, y) => dist(x) - dist(y));
  return mate?.location;
}

export async function teamFixes(session: Session, player: Player): Promise<void> {
  const { state } = session;
  if (!state) return;
  const teams = state.teams.filter((t) => t.status !== 'eliminated');
  if (teams.length === 0) {
    player.sendMessage('There is no team to fix.');
    return;
  }
  const form = new ModalFormData()
    .title('Team fixes')
    .dropdown('Team', teams.map((t) => `${t.color}${t.name}§r`))
    .dropdown('Fix', FIXES)
    .slider('Penalty (race minutes)', 5, 180, { defaultValue: 30, valueStep: 5 });
  const response = await showForm(player, async (p) => form.show(p), session.log, 'Team fixes');
  const [t, f, m] = response?.formValues ?? [];
  const team = typeof t === 'number' ? teams[t] : undefined;
  if (!team || typeof f !== 'number') return;
  if (f === 3) {
    const body = `${team.name} will be out of the race.`;
    const menu = confirmMenu('Eliminate team', body, 'Eliminate');
    if (await showMenu(player, menu, session.log) !== 'yes') return;
  }
  const fix: Fix | undefined = [
    { kind: 'penalty' as const, minutes: typeof m === 'number' ? m : 0 },
    { kind: 'skip' as const },
    { kind: 'goto' as const, at: memberPos(session, team.id, player) },
    { kind: 'eliminate' as const },
  ][f];
  if (fix) {
    session.dispatch({
      type: 'teamFix', by: player.id, team: team.id, fix,
    });
  }
}
