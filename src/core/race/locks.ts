// Who cannot move right now: the one place that says so, for the effects that lock and unlock
// and for the world reloading in the middle of a countdown.
import type { PlayerId, State } from '../types.js';

/**
 * Members of a team that is waiting to depart (the start countdown, the rest and the staggered
 * departures of spec §8.5) or serving a penalty on the Pit Stop mat (spec §8.4). An eliminated
 * team is never locked.
 */
export const lockedPlayers = (state: State): PlayerId[] => state.teams
  .filter((t) => t.status !== 'eliminated'
    && (t.departAt !== undefined || (t.status === 'racing' && t.arrivedAt !== undefined)))
  .flatMap((t) => t.members);
