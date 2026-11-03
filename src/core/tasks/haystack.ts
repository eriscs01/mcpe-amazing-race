// Haystack (spec §7.1): a 5 × 5 × 3 pile of hay with yellow wool hidden in its middle layer's
// inner 3 × 3, one for each team (at most 9). Done when a racer breaks a hidden wool.
import { BLOCK, TASK } from '../config.js';

import type { TaskKind } from './kind.js';
import type { Vec3 } from '../vec.js';

const { haystack: spec } = TASK;
const reach = (spec.size - 1) / 2;

/** The nine interior cells of the middle layer, where the wool may hide. */
const interior = (centre: Vec3): Vec3[] => [-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dz) => ({
  x: centre.x + dx, y: centre.y + 2, z: centre.z + dz,
})));

export const haystack: TaskKind = {
  name: 'haystack',
  initial: { broken: 0 },
  build: (ctx, rng) => {
    const { centre } = ctx;
    const hidden = rng.shuffle(interior(centre)).slice(0, Math.min(ctx.teams, spec.maxHidden));
    return {
      hidden,
      ops: [
        {
          kind: 'fill',
          from: { x: centre.x - reach, y: centre.y + 1, z: centre.z - reach },
          to: { x: centre.x + reach, y: centre.y + spec.height, z: centre.z + reach },
          block: BLOCK.hayBlock,
        },
        ...hidden.map((pos) => ({ kind: 'set' as const, pos, block: BLOCK.yellowWool })),
      ],
    };
  },
  equip: () => [],
  onEvent: (progress, event, ctx) => {
    if (event.type !== 'blockBroken' || event.id !== BLOCK.yellowWool) return progress;
    const found = ctx.hidden.some((h) => h.x === event.block.x && h.y === event.block.y
      && h.z === event.block.z);
    return found ? { broken: (progress.broken ?? 0) + 1 } : progress;
  },
  done: (progress) => (progress.broken ?? 0) >= 1,
  progressText: (_progress, ctx) => `${ctx.label}: dig for the hidden wool`,
};
