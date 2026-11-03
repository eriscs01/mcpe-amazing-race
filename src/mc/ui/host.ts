// Host menu (spec §4): shows the phase-aware model from core and runs the chosen command.
import { world } from '@minecraft/server';
import { ModalFormData } from '@minecraft/server-ui';

import {
  addLandmark, buildArenas, clearLandmarks, discardCourse, generateCourse, listStops,
} from './course.js';
import { showForm, showMenu } from './forms.js';
import { hostMenu, teamsMenu } from '../../core/menu.js';
import { COPY_WORLD_REMINDER, settingsFromValues, setupFields } from '../../core/setup.js';
import { swapCandidates } from '../../core/teams.js';

import type { Player } from '@minecraft/server';

import type { HostCommand, TeamsCommand } from '../../core/menu.js';
import type { Session } from '../../core/session.js';
import type { State } from '../../core/types.js';

/** Runs a host menu command; resolves true when the host menu should be shown again. */
type Handler = (session: Session, player: Player) => Promise<boolean>;

/** Form values that hold answers; text-only rows may leave undefined slots. */
const answers = (values: readonly unknown[] | undefined): unknown[] => (values ?? [])
  .filter((v) => v !== undefined);

const onlineIds = (): string[] => world.getPlayers().map((p) => p.id);

/** Menu commands need the race state; without it (save unreadable) they log and stop. */
function stateFor(session: Session, form: string): State | undefined {
  if (!session.state) session.log.warn('formNoState', { form, status: session.loadStatus });
  return session.state;
}

async function setup(session: Session, player: Player): Promise<boolean> {
  const state = stateFor(session, 'Setup');
  if (!state) return false;
  const form = new ModalFormData().title('Setup').label(COPY_WORLD_REMINDER);
  for (const field of setupFields(state.settings)) {
    if (field.kind === 'slider') {
      form.slider(field.label, field.min, field.max, {
        defaultValue: field.value, valueStep: field.step,
      });
    } else {
      form.toggle(field.label, { defaultValue: field.value });
    }
  }
  form.submitButton('Save');
  const response = await showForm(player, async (p) => form.show(p), session.log, 'Setup');
  if (!response) return false;
  const settings = settingsFromValues(response.formValues);
  if (!settings) {
    session.log.warn('formUnreadable', {
      player: player.id, form: 'Setup', values: JSON.stringify(response.formValues),
    });
    player.sendMessage('The Setup form could not be read. Try again.');
    return false;
  }
  // Spec §4: after saving, the menu shows the derived plan. A refusal was already explained.
  return session.dispatch({ type: 'saveSettings', by: player.id, settings });
}

function autoAssign(session: Session, player: Player): void {
  session.dispatch({
    type: 'autoAssignTeams',
    by: player.id,
    players: world.getPlayers().map((p) => ({ id: p.id, name: p.name })),
    seed: Math.floor(Math.random() * 2 ** 32),
  });
}

async function swap(session: Session, player: Player): Promise<void> {
  const state = stateFor(session, 'Swap');
  if (!state) return;
  const ids = swapCandidates(state, onlineIds());
  if (ids.length < 2) {
    player.sendMessage('There are not two players to swap yet.');
    return;
  }
  const names = ids.map((id) => state.players[id]?.name ?? id);
  const form = new ModalFormData()
    .title('Swap two players')
    .dropdown('Player', names)
    .dropdown('Swap with', names, { defaultValueIndex: 1 });
  const response = await showForm(player, async (p) => form.show(p), session.log, 'Swap');
  const [i, j] = answers(response?.formValues);
  const a = typeof i === 'number' ? ids[i] : undefined;
  const b = typeof j === 'number' ? ids[j] : undefined;
  if (a === undefined || b === undefined) return;
  session.dispatch({
    type: 'swapPlayers', by: player.id, a, b,
  });
}

type TeamsHandler = (session: Session, player: Player) => Promise<void> | void;

const TEAMS_COMMANDS: Record<TeamsCommand, TeamsHandler> = {
  autoAssign,
  swap,
};

/** The Teams screen; it opens again after each change so the host sees the result. */
async function teams(session: Session, player: Player): Promise<boolean> {
  const state = stateFor(session, 'Teams');
  if (!state) return false;
  const command = await showMenu(player, teamsMenu(state, onlineIds()), session.log);
  if (command === undefined) return false;
  await TEAMS_COMMANDS[command](session, player);
  return teams(session, player);
}

async function transferHost(session: Session, player: Player): Promise<boolean> {
  const others = world.getPlayers().filter((p) => p.id !== player.id);
  if (others.length === 0) {
    player.sendMessage('No other players are online.');
    return false;
  }
  const form = new ModalFormData()
    .title('Transfer host')
    .dropdown('New host', others.map((p) => p.name));
  const response = await showForm(player, async (p) => form.show(p), session.log, 'Transfer host');
  const [index] = answers(response?.formValues);
  const target = typeof index === 'number' ? others[index] : undefined;
  if (!target) return false;
  if (!target.isValid) {
    player.sendMessage(`${target.name} has left.`);
    return false;
  }
  session.dispatch({
    type: 'transferHost', by: player.id, to: target.id, toName: target.name,
  });
  return false;
}

/** Course commands open their own screens or act at once; the host menu is not shown again. */
const once = (run: (session: Session, player: Player) => Promise<void> | void): Handler => (
  async (session, player) => {
    await run(session, player);
    return false;
  });

const COMMANDS: Record<HostCommand, Handler> = {
  setup,
  teams,
  addLandmark: once(addLandmark),
  clearLandmarks: once(clearLandmarks),
  generate: once(generateCourse),
  listStops: once(listStops),
  buildArenas: once(buildArenas),
  discardCourse: once(discardCourse),
  transferHost,
};

export async function openHostMenu(session: Session, player: Player): Promise<void> {
  const command = await showMenu(player, hostMenu(session.state), session.log);
  if (command === undefined) return;
  if (await COMMANDS[command](session, player)) await openHostMenu(session, player);
}
