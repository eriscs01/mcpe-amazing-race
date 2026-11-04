// Advantages tests: a four-leg plan with the teams on leg 2, where stop 5 is Route Info, 6 a
// Detour (two archery sides), 7 a quiz Roadblock and 8 the Pit Stop.
import { course } from './flow.js';
import { reduce } from '../../src/core/race/engine.js';

import type {
  Result, State, TaskSpec, Team,
} from '../../src/core/types.js';

const sides: TaskSpec = {
  type: 'detour',
  options: [{ name: 'Aim', kind: 'archery' }, { name: 'Shoot', kind: 'archery' }],
};

/**
 * Leg 2 of a plan with `legs` legs. Red is at `step` (1 is the Detour); blue and green are at
 * `others` (0 is Route Info, not started) unless overridden by `tweak`.
 */
export function legTwo(
  step = 1,
  legs = 4,
  tweak: (t: Team) => Team = (t) => t,
): State {
  const base = course({ 6: sides });
  return {
    ...base,
    plan: {
      legs, legsPerDay: legs, radius: 400, eliminationLegs: [],
    },
    leg: { n: 2, phase: 'racing' },
    teams: base.teams.map((t) => tweak({ ...t, leg: 2, step: t.id === 'red' ? step : 0 })),
  };
}

export const withPass = (expiresLeg = 2) => (t: Team): Team => (
  t.id === 'red' ? { ...t, expressPass: { expiresLeg } } : t);

export const team = (state: State, id: string): Team => {
  const found = state.teams.find((t) => t.id === id);
  if (!found) throw new Error(`no team ${id}`);
  return found;
};

export const tick = (state: State): Result => reduce(state, { type: 'tick' });

/** The state with team `id` changed by `patch`. */
export const patch = (state: State, id: string, change: Partial<Team>): State => ({
  ...state, teams: state.teams.map((t) => (t.id === id ? { ...t, ...change } : t)),
});

/** The state with every team but red moved back to leg 1, so red is alone on leg 2. */
export const alone = (state: State): State => ({
  ...state, teams: state.teams.map((t) => (t.id === 'red' ? t : { ...t, leg: 1 })),
});
