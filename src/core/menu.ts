// What using a menu item does, and what each menu shows (spec §3, §4). Menus are plain models;
// the adapter renders them as forms and turns the chosen command into actions.
import { hostName } from './host.js';
import { isPlainClock, roleOf } from './items.js';

import type { HeldItem } from './items.js';
import type { Phase, PlayerId, State } from './types.js';

export type UseRoute = { kind: 'hostMenu' } | { kind: 'passport' } | { kind: 'claimHost' }
  | { kind: 'say'; text: string };

export interface Use {
  held: HeldItem;
  player: PlayerId;
  sneaking: boolean;
}

/**
 * Decides what using `held` does. `state` is undefined only when the save could not be read:
 * then the host-item gestures open the host menu, which explains why nothing else works.
 */
export function routeUse(use: Use, state: State | undefined): UseRoute | undefined {
  const role = roleOf(use.held);
  if (role === 'passport') return state ? { kind: 'passport' } : undefined;
  const clockGesture = role === 'raceControl' || (use.sneaking && isPlainClock(use.held));
  if (!clockGesture) return undefined;
  const isHost = role === 'raceControl' && state?.hostId === use.player;
  if (!state || isHost) return { kind: 'hostMenu' };
  if (use.sneaking) return { kind: 'claimHost' };
  return { kind: 'say', text: `Race Control belongs to the host (${hostName(state)}).` };
}

export type HostCommand = 'transferHost';

export interface MenuButton<C> {
  command: C;
  label: string;
}

export interface Menu<C> {
  title: string;
  body: string;
  buttons: MenuButton<C>[];
}

/** Host menu entries in display order. Later groups add rows here with the phases they apply to. */
export const HOST_ENTRIES: readonly {
  readonly command: HostCommand;
  readonly label: string;
  readonly phases: 'all' | readonly Phase[];
}[] = [
  { command: 'transferHost', label: 'Transfer host', phases: 'all' },
];

export const PHASE_LABEL: Record<Phase, string> = {
  setup: 'Setup',
  generating: 'Generating course',
  ready: 'Ready to start',
  running: 'Racing',
  paused: 'Paused',
  dayEnded: 'Day ended',
  finished: 'Finished',
};

export const UNREADABLE_TEXT = 'Saved race unreadable — see Content Log.';

export function hostMenu(state: State | undefined): Menu<HostCommand> {
  const title = 'Race Control';
  if (!state) return { title, body: UNREADABLE_TEXT, buttons: [] };
  const buttons = HOST_ENTRIES
    .filter((e) => e.phases === 'all' || e.phases.includes(state.phase))
    .map(({ command, label }) => ({ command, label }));
  return { title, body: `Phase: ${PHASE_LABEL[state.phase]}`, buttons };
}

export function passportMenu(state: State, player: PlayerId): Menu<never> {
  const teamId = state.players[player]?.teamId;
  const team = state.teams.find((t) => t.id === teamId);
  const line = team ? `Team: ${team.color}${team.name}§r` : 'You are not on a team yet.';
  const body = `${line}\nPhase: ${PHASE_LABEL[state.phase]}`;
  return { title: 'Race Passport', body, buttons: [] };
}
