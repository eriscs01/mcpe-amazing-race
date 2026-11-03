// The race reducer: (state, action) → new state and the effects the adapter must apply.
import { advanceClock } from '../clock.js';
import { canEnter } from '../phase.js';

import type { Action, Result, State } from '../types.js';

function setPhase(state: State, action: Extract<Action, { type: 'setPhase' }>): Result {
  if (canEnter(state.phase, action.to)) {
    return { state: { ...state, phase: action.to }, effects: [] };
  }
  const code = 'badPhase';
  const text = `Not possible while the race is in ${state.phase}.`;
  return {
    state,
    refusal: code,
    effects: action.by ? [{
      kind: 'notify', to: action.by, code, text,
    }] : [],
  };
}

export function reduce(state: State, action: Action): Result {
  switch (action.type) {
    case 'tick':
      return { state: advanceClock(state), effects: [] };
    case 'setPhase':
      return setPhase(state, action);
    default: {
      const unknown: never = action;
      throw new Error(`unknown action ${JSON.stringify(unknown)}`);
    }
  }
}
