// A small ready-to-start course for the race-start and clue-box tests: two teams, the start line
// and two legs, every arena built.
import { createState } from '../../src/core/state.js';

import type {
  Phase, State, Stop, StopType, Team,
} from '../../src/core/types.js';
import type { Vec3 } from '../../src/core/vec.js';

const TYPES: StopType[] = ['start', 'route', 'detour', 'roadblock', 'pit', 'route', 'detour',
  'roadblock', 'finish'];

export const stops = (): Stop[] => TYPES.map((type, id) => ({
  id,
  leg: id === 0 ? 0 : Math.ceil(id / 4),
  type,
  pos: { x: id * 100, y: 70, z: -id * 10 },
  terrain: 'plains',
  name: `Place ${id}`,
  blind: false,
  built: true,
  lit: false,
}));

export const team = (id: string, color: string, members: string[]): Team => ({
  id,
  name: `${id.charAt(0).toUpperCase()}${id.slice(1)}`,
  color,
  members,
  status: 'racing',
  leg: 0,
  step: 0,
  penaltyOwed: 0,
  checkIns: [],
  roadblockCounts: {},
  uTurnUsed: false,
  speedBump: false,
  progress: {},
  lastClearedStop: 0,
});

/** Host Hana races with Ben (red); Cy and Di are blue; Eli is online but on no team. */
export function readyRace(phase: Phase = 'ready'): State {
  return {
    ...createState(5),
    phase,
    hostId: 'h',
    job: 3,
    start: { x: 0, y: 70, z: 0 },
    players: {
      h: { name: 'Hana', teamId: 'red' },
      b: { name: 'Ben', teamId: 'red' },
      c: { name: 'Cy', teamId: 'blue' },
      d: { name: 'Di', teamId: 'blue' },
      e: { name: 'Eli' },
    },
    teams: [team('red', '§c', ['h', 'b']), team('blue', '§9', ['c', 'd'])],
    stops: stops(),
  };
}

/** The race after GO: everyone on leg 1, step 0. */
export function racing(): State {
  const state = readyRace('running');
  return {
    ...state,
    leg: { n: 1, phase: 'racing' },
    teams: state.teams.map((t) => ({ ...t, leg: 1 })),
  };
}

export function stopOf(state: State, id: number): Stop {
  const found = state.stops.find((s) => s.id === id);
  if (!found) throw new Error(`no stop ${id}`);
  return found;
}

/** The block of a stop's clue box. */
export const boxOf = (state: State, id: number): Vec3 => {
  const { pos } = stopOf(state, id);
  return { ...pos, y: pos.y + 1 };
};
