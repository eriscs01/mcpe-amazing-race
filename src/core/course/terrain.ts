// Ground walk and classification (spec §6.2): pure rules over block ids. The adapter supplies
// the block at each height; nothing here knows Minecraft.
import {
  BLOCK, TERRAIN_BLOCKS, TERRAIN_FALLBACK, TERRAIN_PROBE, TERRAINS,
} from '../config.js';

import type { Terrain } from '../config.js';

export interface Ground {
  /** Height of the ground block. */
  y: number;
  id: string;
  /** Leaves or logs were passed on the way down. */
  forest: boolean;
  /** A snow layer was passed on the way down. */
  snow: boolean;
  /** The ground is water or lava. */
  liquid?: true;
}

const AIR: ReadonlySet<string> = new Set([BLOCK.air]);
const LIQUID: ReadonlySet<string> = new Set([
  BLOCK.water, BLOCK.flowingWater, BLOCK.lava, BLOCK.flowingLava,
]);
const PLANTS: ReadonlySet<string> = new Set([
  BLOCK.shortGrass, BLOCK.tallGrass, BLOCK.fern, BLOCK.largeFern, BLOCK.vine, BLOCK.deadBush,
]);
const TREE_SUFFIXES = ['_leaves', '_log', '_wood'];
const PLANT_SUFFIXES = ['_sapling', '_flower', '_tulip', '_bush'];

const isTree = (id: string): boolean => TREE_SUFFIXES.some((s) => id.endsWith(s));
const isPlant = (id: string): boolean => (
  PLANTS.has(id) || PLANT_SUFFIXES.some((s) => id.endsWith(s)));

/**
 * Walks down from the topmost block (height `top`) through air, plants, leaves, logs and snow
 * layers to the ground. `idAt` gives the block id at a height, or undefined when the chunk is
 * not loaded. Undefined if no ground is found within the probe depth.
 */
export function groundOf(
  top: number,
  idAt: (y: number) => string | undefined,
): Ground | undefined {
  let forest = false;
  let snow = false;
  for (let y = top; y > top - TERRAIN_PROBE.maxDepth; y -= 1) {
    const id = idAt(y);
    if (id === undefined) return undefined;
    if (isTree(id)) forest = true;
    else if (id === BLOCK.snowLayer) snow = true;
    else if (!AIR.has(id) && !isPlant(id)) {
      const ground: Ground = {
        y, id, forest, snow,
      };
      if (LIQUID.has(id)) ground.liquid = true;
      return ground;
    }
  }
  return undefined;
}

/** Terrain of a ground: snow and forest markers first, then the ground block, else plains. */
export function classify(ground: Pick<Ground, 'id' | 'forest' | 'snow'>): Terrain {
  if (ground.snow) return 'snowy';
  if (ground.forest) return 'forest';
  return TERRAINS.find((t) => (TERRAIN_BLOCKS[t] as readonly string[]).includes(ground.id))
    ?? TERRAIN_FALLBACK;
}

export type Assessment = | { ok: true; terrain: Terrain; y: number; spread: number }
  | { ok: false; reason: 'liquid' | 'rough' | 'noGround' };

/**
 * Accepts a site from its centre ground and the four ground samples around it: rejects a
 * liquid centre or a height spread over the limit, and reports terrain, centre height, spread.
 */
export function assess(
  centre: Ground | undefined,
  arms: readonly (Ground | undefined)[],
): Assessment {
  if (!centre || arms.some((a) => !a)) return { ok: false, reason: 'noGround' };
  if (centre.liquid) return { ok: false, reason: 'liquid' };
  const heights = [centre.y, ...arms.map((a) => a?.y ?? centre.y)];
  const spread = Math.max(...heights) - Math.min(...heights);
  if (spread > TERRAIN_PROBE.maxSpread) return { ok: false, reason: 'rough' };
  return {
    ok: true, terrain: classify(centre), y: centre.y, spread,
  };
}
