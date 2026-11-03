// Runs one tick's steps in order, each on the state the previous one left, keeping every effect
// and log line. A step that changes nothing returns the state it was given.
import type { Result, State } from '../types.js';

export type Step = (state: State) => Result;

export function chain(state: State, steps: readonly Step[]): Result {
  return steps.reduce<Result>((acc, step) => {
    const out = step(acc.state);
    return {
      state: out.state,
      effects: [...acc.effects, ...out.effects],
      logs: [...(acc.logs ?? []), ...(out.logs ?? [])],
    };
  }, { state, effects: [] });
}
