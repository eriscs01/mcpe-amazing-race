// Place names (spec §5): prefix + suffix from the stop's terrain table, unique within a course.
import { TERRAIN_NAMES, TERRAINS } from '../config.js';

import type { Terrain } from '../config.js';
import type { Rng } from '../rng.js';

const namesOf = (terrain: Terrain): string[] => {
  const { prefixes, suffixes } = TERRAIN_NAMES[terrain];
  return prefixes.flatMap((p) => suffixes.map((s) => `${p} ${s}`));
};

/**
 * A name for a stop on `terrain` not in `used`. When the terrain's names are all taken (only
 * possible with many extra Route Info stops) another terrain's name is used, so names never repeat.
 */
export function placeName(terrain: Terrain, used: ReadonlySet<string>, rng: Rng): string {
  const free = namesOf(terrain).filter((n) => !used.has(n));
  if (free.length > 0) return rng.pick(free);
  return rng.pick(TERRAINS.flatMap(namesOf).filter((n) => !used.has(n)));
}
