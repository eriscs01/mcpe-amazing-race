// Arena protection and the sweeps (spec §7.4, §9.4): which blocks a racer may break inside a lit
// arena, taking back a block they placed, and what the adapter's periodic sweeps may remove. All
// pure; the adapter asks these questions and carries out the answers.
import { playing, teamOf } from './task.js';
import { zonesFor } from '../arena/layout.js';
import { ARENA, RULES, TASK } from '../config.js';
import { huntTag } from '../tasks/hunt.js';

import type {
  Action, PlayerId, Result, State, Stop,
} from '../types.js';
import type { Vec3 } from '../vec.js';

export interface Area {
  min: Vec3;
  max: Vec3;
}

const { half, dirtDepth, clearHeight } = ARENA;
const { haystack: pile } = TASK;
const reach = (pile.size - 1) / 2;

const inside = (p: Vec3, a: Area): boolean => p.x >= a.min.x && p.x <= a.max.x
  && p.y >= a.min.y && p.y <= a.max.y && p.z >= a.min.z && p.z <= a.max.z;

/** The protected space of an arena: the 19 × 19 floor, from its dirt to the cleared height. */
const areaOf = (stop: Stop): Area => ({
  min: { x: stop.pos.x - half, y: stop.pos.y - dirtDepth, z: stop.pos.z - half },
  max: { x: stop.pos.x + half, y: stop.pos.y + clearHeight, z: stop.pos.z + half },
});

const active = (state: State): boolean => state.phase === 'running' || state.phase === 'paused';

const litStops = (state: State): Stop[] => (active(state)
  ? state.stops.filter((s) => s.lit && s.built) : []);

/** The hay piles of built haystack zones at lit stops. */
function piles(stop: Stop): Area[] {
  return zonesFor(stop.type, stop.pos)
    .filter((z) => stop.zones?.[z.zone]?.kind === 'haystack')
    .map(({ centre }) => ({
      min: { x: centre.x - reach, y: centre.y + 1, z: centre.z - reach },
      max: { x: centre.x + reach, y: centre.y + pile.height, z: centre.z + reach },
    }));
}

const isRacer = (state: State, id: PlayerId): boolean => {
  const team = teamOf(state, id);
  return team !== undefined && team.status !== 'eliminated';
};

const pileBlock = (id: string): boolean => (RULES.pileBlocks as readonly string[]).includes(id);

/**
 * Whether the break stands. A racer may break only the hay and wool of a haystack pile inside a
 * lit arena. Anyone else may break anything there except those, so a stray break cannot leave a
 * hidden wool the core still lists (#50). Outside lit arenas, nothing is protected.
 */
export function breakAllowed(state: State, player: PlayerId, pos: Vec3, block: string): boolean {
  const here = litStops(state).filter((s) => inside(pos, areaOf(s)));
  if (here.length === 0) return true;
  const inPile = here.some((s) => piles(s).some((a) => inside(pos, a)));
  if (isRacer(state, player)) return inPile && pileBlock(block);
  return !(inPile && pileBlock(block));
}

/** A racer's block inside a lit arena is taken back and the item returned (spec §7.4). */
export function blockPlaced(state: State, a: Extract<Action, { type: 'blockPlaced' }>): Result {
  const guarded = isRacer(state, a.player)
    && litStops(state).some((s) => inside(a.pos, areaOf(s)));
  if (!guarded) return { state, effects: [] };
  return {
    state,
    effects: [{
      kind: 'undoPlace', player: a.player, pos: a.pos, block: a.block, item: a.item,
    }],
    logs: [{
      event: 'blockUndone', fields: { player: a.player, item: a.item, clock: state.clock },
    }],
  };
}

/** The lit arenas, for the mob sweep (every 5 s); none unless the race is running. */
export function sweepAreas(state: State): Area[] {
  return state.phase === 'running' ? litStops(state).map(areaOf) : [];
}

/** Hunt husks that stay: those of a Hunt a racing team is playing at this moment (#53). */
export function sweepKeep(state: State): string[] {
  return state.teams.flatMap((team) => {
    const now = playing(state, team);
    return now?.offer.kind.name === 'hunt'
      ? [huntTag(team.id, now.stop.id, now.offer.option)] : [];
  });
}

/** Racers whose inventories lose elytra and ender pearls (every 10 s). */
export function sweepTargets(state: State): PlayerId[] {
  if (state.phase !== 'running') return [];
  return state.teams.filter((t) => t.status !== 'eliminated').flatMap((t) => t.members);
}
