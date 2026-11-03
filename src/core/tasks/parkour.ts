// Parkour (spec §7.1): white concrete platforms across the zone, the last one gold. Done when a
// racer stands on the gold block (the adapter's position report arrives every 10 ticks).
import { ARENA, BLOCK, TASK } from '../config.js';
import { isEarly } from './kind.js';

import type { TaskContext, TaskKind } from './kind.js';
import type { Vec3 } from '../vec.js';

const { parkour: spec } = TASK;

export interface Course {
  platforms: Vec3[];
  gold: Vec3;
}

/**
 * One platform per jump, in a line along the zone starting at the arena's north edge: a block
 * every `gap + 1`, rising one block every `riseEvery` jumps. The first jump is a step up from
 * the floor; the last platform is the gold block.
 */
export function parkourCourse(ctx: TaskContext): Course {
  const { jumps, gap } = isEarly(ctx.leg) ? spec.early : spec.late;
  const platforms = Array.from({ length: jumps }, (_, i) => ({
    x: ctx.centre.x,
    y: ctx.centre.y + 1 + Math.floor(i / spec.riseEvery),
    z: ctx.stop.pos.z - ARENA.half + (gap + 1) * (i + 1),
  }));
  const gold = platforms.at(-1);
  if (!gold) throw new Error('a parkour course has at least one jump');
  return { platforms, gold };
}

/** Feet on top of the block: within it horizontally, at its top surface or a little above. */
const standsOn = (pos: Vec3, block: Vec3): boolean => Math.floor(pos.x) === block.x
  && Math.floor(pos.z) === block.z && pos.y >= block.y + 1 - 0.1 && pos.y <= block.y + 1.9;

export const parkour: TaskKind = {
  name: 'parkour',
  initial: { done: 0 },
  build: (ctx) => {
    const { platforms, gold } = parkourCourse(ctx);
    return {
      ops: platforms.map((pos) => ({
        kind: 'set',
        pos,
        block: pos === gold ? BLOCK.goldBlock : BLOCK.whiteConcrete,
      })),
    };
  },
  equip: () => [],
  onEvent: (progress, event, ctx) => {
    if (event.type !== 'standing' || progress.done === 1) return progress;
    return standsOn(event.pos, parkourCourse(ctx).gold) ? { done: 1 } : progress;
  },
  done: (progress) => progress.done === 1,
  progressText: (_progress, ctx) => `${ctx.label}: reach the gold block`,
};
