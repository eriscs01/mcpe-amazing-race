// End race (spec §12): the host's way out. Hunt husks go, the world goes back to how the race
// found it, the sidebar goes, and every player is released. Arenas stay in the world.
import { refuse, refuseUnlessHost } from '../host.js';

import type {
  Action, Effect, Result, State,
} from '../types.js';

const WHEN = ['running', 'paused', 'dayEnded', 'finished'] as const;

export function endRace(state: State, a: Extract<Action, { type: 'endRace' }>): Result {
  const denied = refuseUnlessHost(state, a.by, WHEN);
  if (denied) return denied;
  if (state.ended) return refuse(state, a.by, 'alreadyEnded', 'The race has been ended already.');
  const players = state.teams.flatMap((t) => t.members);
  const effects: Effect[] = [
    { kind: 'clearHusks' },
    ...(state.snapshot ? [{ kind: 'restoreWorld' as const, snapshot: state.snapshot }] : []),
    { kind: 'clearSidebar' },
    { kind: 'resetPlayers', players },
    ...players.map((id): Effect => ({ kind: 'takeItem', from: id, item: 'passport' })),
    { kind: 'lockMovement', players, locked: false },
    { kind: 'broadcast', text: 'The race has been ended by the host.' },
  ];
  return {
    state: { ...state, phase: 'finished', ended: true },
    effects,
    logs: [{
      event: 'raceEnded',
      fields: {
        by: a.by, from: state.phase, snapshot: state.snapshot !== undefined, players: players.length,
      },
    }],
  };
}
