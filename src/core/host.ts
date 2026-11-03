// Host role rules (spec §3, §12): who holds Race Control, how the role is claimed, replaced
// and handed over, and when a rejoining racer is given a missing Passport.
import type {
  Action, Effect, Phase, PlayerId, Result, State,
} from './types.js';

type Of<T extends Action['type']> = Extract<Action, { type: T }>;

/** Phases in which racers hold a Passport (given at race start, removed at the end). */
const PASSPORT_PHASES: readonly Phase[] = ['running', 'paused', 'dayEnded'];

const CLAIMED = 'You are now the race host. Use Race Control to open the host menu.';

const notify = (to: PlayerId, code: string, text: string): Effect => ({
  kind: 'notify', to, code, text,
});

export function hostName(state: State): string {
  return (state.hostId && state.players[state.hostId]?.name) ?? 'another player';
}

/** Records the player's current name; returns the same state when nothing changed. */
function withName(state: State, player: PlayerId, name: string): State {
  const known = state.players[player];
  if (known?.name === name) return state;
  return { ...state, players: { ...state.players, [player]: { ...known, name } } };
}

function refuse(state: State, to: PlayerId, code: string, text: string): Result {
  return { state, refusal: code, effects: [notify(to, code, text)] };
}

/** The host's item is replaced: any old copies are removed so only one is in circulation. */
function replaceItem(state: State, host: PlayerId): Result {
  return {
    state,
    effects: [
      { kind: 'takeItem', from: host, item: 'raceControl' },
      { kind: 'giveItem', to: host, item: 'raceControl' },
      notify(host, 'hostItemReplaced', 'Here is a fresh Race Control.'),
    ],
  };
}

/**
 * Makes `to` the host; the previous host, if any, loses the item and is told who took over.
 * `to` loses any stale copy first (one kept while offline), so exactly one is issued.
 */
function handOver(state: State, to: PlayerId, name: string, toText: string): Result {
  const previous = state.hostId;
  const effects: Effect[] = previous === undefined ? [] : [
    { kind: 'takeItem', from: previous, item: 'raceControl' },
    notify(previous, 'hostLost', `${name} is now the race host.`),
  ];
  effects.push(
    { kind: 'takeItem', from: to, item: 'raceControl' },
    { kind: 'giveItem', to, item: 'raceControl' },
    notify(to, 'hostClaimed', toText),
  );
  return { state: { ...withName(state, to, name), hostId: to }, effects };
}

export function playerSpawned(state: State, a: Of<'playerSpawned'>): Result {
  const known = state.players[a.player];
  if (state.hostId === undefined) return handOver(state, a.player, a.name, CLAIMED);
  const effects: Effect[] = [];
  if (a.initial && !a.hasPassport && known?.teamId && PASSPORT_PHASES.includes(state.phase)) {
    effects.push({ kind: 'giveItem', to: a.player, item: 'passport' });
  }
  return { state: withName(state, a.player, a.name), effects };
}

export function claimHost(state: State, a: Of<'claimHost'>): Result {
  if (state.hostId === a.by) return replaceItem(withName(state, a.by, a.name), a.by);
  if (a.via === 'clock' && state.hostId !== undefined) {
    return refuse(state, a.by, 'notHost', `Only the host (${hostName(state)}) can do that.`);
  }
  return handOver(state, a.by, a.name, CLAIMED);
}

export function transferHost(state: State, a: Of<'transferHost'>): Result {
  if (state.hostId !== a.by) return refuse(state, a.by, 'notHost', 'Only the host can do that.');
  if (a.to === a.by) return refuse(state, a.by, 'alreadyHost', 'You are already the host.');
  const by = state.players[a.by]?.name ?? 'The host';
  return handOver(state, a.to, a.toName, `${by} made you the race host.`);
}
