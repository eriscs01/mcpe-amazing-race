// Race clock (spec §11): every race timer compares against it, so pausing or ending the day
// freezes them all without extra bookkeeping.
import type { State } from './types.js';

export function advanceClock(state: State): State {
  return state.phase === 'running' ? { ...state, clock: state.clock + 1 } : state;
}
