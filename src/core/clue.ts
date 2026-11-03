// Clues and the public scoreboard (spec §8.3, §10): which stop a team is heading for, what its
// clue says, which block is a stop's clue box, and the sidebar rows. Pure text and lookups.
import { ARENA, CLUE, RACE } from './config.js';
import { planOf } from './plan.js';

import type {
  SidebarRow, State, Stop, Team,
} from './types.js';
import type { Vec3 } from './vec.js';

const MINUS = '−';

/** Stops of a leg in the order they are played. */
export const legStops = (state: State, leg: number): Stop[] => state.stops
  .filter((s) => s.leg === leg)
  .sort((a, b) => a.id - b.id);

/** The stop the team is heading for, or undefined when its leg has no such step. */
export const targetStop = (state: State, team: Team): Stop | undefined => (
  legStops(state, team.leg)[team.step]);

/** The block that holds a stop's clue box (spec §6.5): one above the arena floor. */
export const clueBoxPos = (stop: Stop): Vec3 => ({
  x: stop.pos.x, y: stop.pos.y + RACE.clueBoxHeight, z: stop.pos.z,
});

/**
 * The centre of a Pit Stop or Finish mat (spec §6.5): the 3 by 3 checker sits `matOffset`
 * blocks south of the stop's block, one above the floor, centred on a block.
 */
export const matCentre = (stop: Stop): Vec3 => ({
  x: stop.pos.x + 0.5, y: stop.pos.y + 1, z: stop.pos.z + ARENA.matOffset + 0.5,
});

/** The built stop whose clue box is the block at `pos`. */
export const clueBoxAt = (state: State, pos: Vec3): Stop | undefined => state.stops.find((s) => {
  const box = clueBoxPos(s);
  return s.built && box.x === pos.x && box.y === pos.y && box.z === pos.z;
});

const coordinate = (n: number): string => String(n).replace('-', MINUS);

/** What a team is told on reaching the previous stop (spec §8.3). */
export function clueText(state: State, stop: Stop): string {
  const { label, beam } = CLUE[stop.type];
  const where = `${stop.name} (X ${coordinate(stop.pos.x)}, Z ${coordinate(stop.pos.z)})`;
  const look = stop.type === 'pit' || stop.type === 'finish'
    ? `Follow the ${beam} beam to the checkered mat.` : `Find the clue box under the ${beam} beam.`;
  const blind = stop.blind ? ' Navigate by coordinates only.' : '';
  if (stop.type === 'pit') {
    const plan = state.plan ?? planOf(state);
    const danger = plan.eliminationLegs.includes(stop.leg)
      ? ' The last team to arrive may be eliminated!' : '';
    return `Check in at the Pit Stop: ${where}.${danger} ${look}${blind}`;
  }
  return `Leg ${stop.leg} · ${label} — Make your way to ${where}. ${look}${blind}`;
}

/** Stops a team has cleared: every stop of its earlier legs, plus the steps done in this one. */
const cleared = (state: State, team: Team): number => state.stops
  .filter((s) => s.leg >= 1 && s.leg < team.leg).length + team.step;

/** One entry per team; the score is the stops cleared (spec §10). */
export const sidebarRows = (state: State): SidebarRow[] => state.teams.map((t) => ({
  name: `${t.status === 'eliminated' ? '[OUT] ' : ''}${t.color}${t.name}§r`,
  score: cleared(state, t),
}));
