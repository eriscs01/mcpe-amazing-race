// The clock tick: advances the race clock, then lets the race move on by it (spec §8): penalties
// served on the mat, the leg's end, the rest and the departures.
import { advanceClock } from '../clock.js';
import { chain } from './chain.js';
import { settleLeg } from './legEnd.js';
import { settlePenalties } from './pitstop.js';

import type { Result, State } from '../types.js';

export function tick(state: State): Result {
  const next = advanceClock(state);
  return chain(next, [settlePenalties, settleLeg]);
}
