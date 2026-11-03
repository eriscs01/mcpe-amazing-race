// Archery (spec §7.1): six targets on the zone's outer wall; hit enough different ones from at
// least 8 blocks away. Progress is a bitmask of the target slots hit.
import {
  ARENA, BLOCK, ITEM, TASK,
} from '../config.js';
import { horizontalDistance } from '../vec.js';
import { isEarly } from './kind.js';

import type { TaskContext, TaskKind } from './kind.js';
import type { Vec3 } from '../vec.js';

const { archery: spec } = TASK;

/** Where the six targets are: on the wall of the arena on the zone's side. */
export function archeryTargets(ctx: TaskContext): Vec3[] {
  const x = ctx.stop.pos.x + (ctx.zone === 'A' ? -ARENA.half : ARENA.half);
  return spec.zOffsets.map((dz, i) => ({
    x, y: ctx.stop.pos.y + (spec.heights[i] ?? 0), z: ctx.stop.pos.z + dz,
  }));
}

const needed = (leg: number): number => (isEarly(leg) ? spec.needed.early : spec.needed.late);
const count = (mask: number): number => mask.toString(2).replaceAll('0', '').length;
const sameBlock = (a: Vec3, b: Vec3): boolean => Math.floor(a.x) === b.x
  && Math.floor(a.y) === b.y && Math.floor(a.z) === b.z;

export const archery: TaskKind = {
  name: 'archery',
  initial: { hits: 0 },
  build: (ctx) => ({
    ops: archeryTargets(ctx).map((pos) => ({ kind: 'set', pos, block: BLOCK.target })),
  }),
  equip: (_ctx, players) => players.flatMap((to) => [
    {
      kind: 'giveVanilla' as const, to, item: ITEM.bow, count: 1,
    },
    {
      kind: 'giveVanilla' as const, to, item: ITEM.arrow, count: spec.arrows,
    },
  ]),
  onEvent: (progress, event, ctx) => {
    if (event.type !== 'projectileHit') return progress;
    const slot = archeryTargets(ctx).findIndex((t) => sameBlock(event.block, t));
    if (slot < 0) return progress;
    const centre = { x: event.block.x + 0.5, y: event.block.y, z: event.block.z + 0.5 };
    if (horizontalDistance(event.shooter, centre) < spec.minDistance) return progress;
    const hits = progress.hits ?? 0;
    // eslint-disable-next-line no-bitwise -- the progress is a bitmask of target slots
    const next = hits | (1 << slot);
    return next === hits ? progress : { hits: next };
  },
  done: (progress, ctx) => count(progress.hits ?? 0) >= needed(ctx.leg),
  progressText: (progress, ctx) => `${ctx.label}: targets ${count(progress.hits ?? 0)}/${
    needed(ctx.leg)}`,
};
