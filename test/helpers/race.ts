// A small ready-to-start course for the race-start and clue-box tests: two teams, the start line
// and two legs, every arena built.
import { createState } from '../../src/core/state.js';

import type {
  Action, Effect, Phase, State, Stop, StopType, Team,
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
    day: 1,
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

/**
 * Three teams (red h+b, blue c+d, green f+g) all heading for the leg 1 Pit Stop (stop 4, the
 * fourth step), on a two-leg plan whose leg 1 eliminates (`eliminating`) or does not.
 */
export function pitRace(eliminating = true): State {
  const state = racing();
  const green = team('green', '§a', ['f', 'g']);
  const players = {
    ...state.players, f: { name: 'Fay', teamId: 'green' }, g: { name: 'Gus', teamId: 'green' },
  };
  return {
    ...state,
    players,
    plan: {
      legs: 2, legsPerDay: 2, radius: 400, eliminationLegs: eliminating ? [1] : [],
    },
    teams: [...state.teams, { ...green, leg: 1 }].map((t) => ({ ...t, step: 3 })),
  };
}

/** The centre of a stop's mat: the stop's block centre, six blocks south (spec §6.5). */
export const matOf = (state: State, id: number): Vec3 => {
  const { pos } = stopOf(state, id);
  return { x: pos.x + 0.5, y: pos.y + 1, z: pos.z + 6.5 };
};

/** What the adapter reports for `ids` standing on stop `id`'s mat. */
export const onMat = (state: State, id: number, ids: string[]): Action => ({
  type: 'racerPositions' as const,
  players: ids.map((p) => ({ id: p, pos: matOf(state, id) })),
});

/** The text of every broadcast, without colour codes. */
export const broadcasts = (effects: Effect[]): string[] => effects.flatMap((e) => (
  e.kind === 'broadcast' ? [e.text.replace(/§./g, '')] : []));
