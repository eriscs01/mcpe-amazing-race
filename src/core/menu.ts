// What using a menu item does, and what each menu shows (spec §3, §4). Menus are plain models;
// the adapter renders them as forms and turns the chosen command into actions.
import { BUILD_PHASES, unbuilt } from './arenas.js';
import {
  DISCARD_PHASES, GENERATE_PHASES, LIST_PHASES, PIN_PHASES,
} from './generation.js';
import { hostName } from './host.js';
import { isPlainClock, roleOf } from './items.js';
import { planOf, planSummary } from './plan.js';
import { expressUsable } from './race/advantages.js';
import { canEndLeg } from './race/legEnd.js';
import { START_PHASES } from './race/start.js';
import { SETTINGS_PHASES } from './setup.js';
import { TEAM_PHASES, teamsView } from './teams.js';

import type { HeldItem } from './items.js';
import type {
  Phase, PlayerId, State, Team,
} from './types.js';

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

export type HostCommand = 'setup' | 'teams' | 'addLandmark' | 'clearLandmarks' | 'generate'
  | 'listStops' | 'buildArenas' | 'startRace' | 'endLeg' | 'discardCourse' | 'transferHost';

export type TeamsCommand = 'autoAssign' | 'swap';

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
  /** An extra condition on the state, for entries that apply only some of the time. */
  readonly when?: (state: State) => boolean;
}[] = [
  { command: 'setup', label: 'Setup', phases: SETTINGS_PHASES },
  { command: 'teams', label: 'Teams', phases: TEAM_PHASES },
  { command: 'addLandmark', label: 'Add landmark here', phases: PIN_PHASES },
  { command: 'clearLandmarks', label: 'Clear landmarks', phases: PIN_PHASES },
  { command: 'generate', label: 'Generate course here', phases: GENERATE_PHASES },
  { command: 'listStops', label: 'List stops', phases: LIST_PHASES },
  {
    command: 'buildArenas',
    label: 'Build arenas',
    phases: BUILD_PHASES,
    when: (s) => unbuilt(s).length > 0,
  },
  { command: 'startRace', label: 'Start race', phases: START_PHASES },
  {
    command: 'endLeg', label: 'End leg now', phases: ['running'], when: canEndLeg,
  },
  { command: 'discardCourse', label: 'Discard course', phases: DISCARD_PHASES },
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
    .filter((e) => (e.phases === 'all' || e.phases.includes(state.phase))
      && (e.when?.(state) ?? true))
    .map(({ command, label }) => ({ command, label }));
  const phase = `Phase: ${PHASE_LABEL[state.phase]}`;
  // The plan follows the settings and teams until the race starts; show it while they can change.
  const body = TEAM_PHASES.includes(state.phase)
    ? `${phase}\n${planSummary(planOf(state), state.teams.length)}`
    : phase;
  return { title, body, buttons };
}

/** The Teams screen (spec §4): its body is the View teams text; `online` are player ids. */
export function teamsMenu(state: State, online: readonly PlayerId[]): Menu<TeamsCommand> {
  return {
    title: 'Teams',
    body: teamsView(state, online),
    buttons: [
      { command: 'autoAssign', label: 'Auto-assign' },
      { command: 'swap', label: 'Swap two players' },
    ],
  };
}

/** The team's advantages as Passport lines (spec §10): Express Pass, U-Turn, Speed Bump. */
function advantageLines(state: State, team: Team): string[] {
  const pass = team.expressPass && expressUsable(state, team)
    ? [`Express Pass: yes (until leg ${team.expressPass.expiresLeg})`] : [];
  const uTurn = team.uTurnUsed ? 'U-Turn: used' : 'U-Turn: available on Detours of legs 2 to L-1';
  const hit = team.uTurnedAt !== undefined ? ['You were U-Turned: do both Detour options.'] : [];
  return [
    ...pass,
    uTurn,
    ...hit,
    ...(team.speedBump ? ['Speed Bump: answer 2 questions at the next Route Info.'] : []),
  ];
}

export function passportMenu(state: State, player: PlayerId): Menu<never> {
  const teamId = state.players[player]?.teamId;
  const team = state.teams.find((t) => t.id === teamId);
  const line = team ? `Team: ${team.color}${team.name}§r` : 'You are not on a team yet.';
  const advantages = team ? advantageLines(state, team) : [];
  const body = [line, `Phase: ${PHASE_LABEL[state.phase]}`, ...advantages].join('\n');
  return { title: 'Race Passport', body, buttons: [] };
}
