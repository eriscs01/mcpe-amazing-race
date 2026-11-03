// The race reducer: (state, action) → new state and the effects the adapter must apply.
import {
  arenaBuildFailed,
  arenaBuilt, buildArenas, setLit,
} from '../arenas.js';
import {
  addPin, clearPins, courseFailed, courseGenerated, discardCourse, startGeneration,
} from '../generation.js';
import { interactClue } from './clueBox.js';
import {
  claimHost, playerSpawned, refuse, transferHost,
} from '../host.js';
import { canEnter } from '../phase.js';
import { saveSettings } from '../setup.js';
import { endLeg } from './legEnd.js';
import { racerPositions } from './pitstop.js';
import { startRace } from './start.js';
import { taskEvent, taskStanding } from './task.js';
import { tick } from './tick.js';
import { autoAssignTeams, swapPlayers } from '../teams.js';

import type { Action, Result, State } from '../types.js';

function setPhase(state: State, action: Extract<Action, { type: 'setPhase' }>): Result {
  if (state.phase === 'ready' && action.to === 'running') {
    // The start rules (host, teams, arenas, kit, countdown) live in startRace.
    const text = 'The race starts from the host menu.';
    return action.by
      ? refuse(state, action.by, 'useStartRace', text)
      : { state, refusal: 'useStartRace', effects: [] };
  }
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
      return tick(state);
    case 'setPhase':
      return setPhase(state, action);
    case 'playerSpawned':
      return playerSpawned(state, action);
    case 'claimHost':
      return claimHost(state, action);
    case 'transferHost':
      return transferHost(state, action);
    case 'saveSettings':
      return saveSettings(state, action);
    case 'autoAssignTeams':
      return autoAssignTeams(state, action);
    case 'swapPlayers':
      return swapPlayers(state, action);
    case 'addPin':
      return addPin(state, action);
    case 'clearPins':
      return clearPins(state, action);
    case 'startGeneration':
      return startGeneration(state, action);
    case 'courseGenerated':
      return courseGenerated(state, action);
    case 'courseFailed':
      return courseFailed(state, action);
    case 'discardCourse':
      return discardCourse(state, action);
    case 'buildArenas':
      return buildArenas(state, action);
    case 'arenaBuilt':
      return arenaBuilt(state, action);
    case 'arenaBuildFailed':
      return arenaBuildFailed(state, action);
    case 'setLit':
      return setLit(state, action);
    case 'startRace':
      return startRace(state, action);
    case 'interactClue':
      return interactClue(state, action);
    case 'racerPositions': {
      const arrived = racerPositions(state, action);
      const standing = taskStanding(arrived.state, action);
      return {
        state: standing.state,
        effects: [...arrived.effects, ...standing.effects],
        logs: [...(arrived.logs ?? []), ...(standing.logs ?? [])],
      };
    }
    case 'taskEvent':
      return taskEvent(state, action);
    case 'endLeg':
      return endLeg(state, action);
    default: {
      const unknown: never = action;
      throw new Error(`unknown action ${JSON.stringify(unknown)}`);
    }
  }
}
