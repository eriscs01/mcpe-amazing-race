// Clue box interaction (spec §8.2): is this the team's current stop, is the team together, and
// what happens next. Route Info is complete here; a Pit Stop or Finish is checked in on its mat
// (pitstop.ts); a Detour or Roadblock starts its task (task.ts) when it is playable, and until
// the other kinds arrive says so.
import { advanceStep } from './advance.js';
import { playable, useTaskBox } from './task.js';
import { clueBoxAt, clueBoxPos, targetStop } from '../clue.js';
import { RACE } from '../config.js';
import { refuse } from '../host.js';
import { distance } from '../vec.js';

import type {
  Action, Result, State, Team,
} from '../types.js';

type Of<T extends Action['type']> = Extract<Action, { type: T }>;

const teamOf = (state: State, id: string): Team | undefined => {
  const teamId = state.players[id]?.teamId;
  return state.teams.find((t) => t.id === teamId);
};

export function interactClue(state: State, a: Of<'interactClue'>): Result {
  if (state.phase !== 'running') {
    return refuse(state, a.player, 'notRacing', 'The race is not under way.');
  }
  const stop = clueBoxAt(state, a.pos);
  const team = teamOf(state, a.player);
  // The adapter only sends clicks on a clue box; reaching here means it and the state disagree.
  if (!stop) return refuse(state, a.player, 'unknownBox', 'That is not a clue box.');
  // Each team leaves on its own time (the start, and after each rest).
  if (team?.departAt !== undefined) return refuse(state, a.player, 'notRacing', 'Wait for GO!');
  const heading = team ? targetStop(state, team) : undefined;
  if (team?.status !== 'racing' || heading?.id !== stop.id) {
    return refuse(state, a.player, 'notYourBox', 'Not your clue box.');
  }
  if (stop.type === 'pit' || stop.type === 'finish') {
    return refuse(state, a.player, 'stopNotReady', 'Stand on the mat to check in.');
  }
  if (stop.type !== 'route' && !playable(stop)) {
    return refuse(state, a.player, 'stopNotReady', `${stop.name} is a ${stop.type} stop; those `
      + 'come in a later update.');
  }
  const centre = {
    x: clueBoxPos(stop).x + 0.5, y: clueBoxPos(stop).y + 0.5, z: clueBoxPos(stop).z + 0.5,
  };
  // While a Roadblock is under way only its performer needs to be there (spec §8.2).
  const mustBeHere = stop.type === 'roadblock' && team.task?.stopId === stop.id
    ? a.members.filter((m) => m.id === team.performer) : a.members;
  const together = mustBeHere.every((m) => m.pos && distance(m.pos, centre) <= RACE.presenceRadius);
  if (!together) {
    return refuse(state, a.player, 'notTogether', 'All teammates must be present.');
  }
  if (stop.type !== 'route') return useTaskBox(state, team, stop, a.player);
  // The Speed Bump quiz comes first here once G15 adds it (spec §8.2).
  return advanceStep(state, team, stop.id);
}
