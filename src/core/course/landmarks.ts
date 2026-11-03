// Landmark detection and arena offset (spec §6.3): pure rules over what a scan found. The
// adapter collects the evidence (entities and blocks near a candidate) and moves nothing itself.
import { BLOCK, ENTITY, LANDMARK } from '../config.js';

import type { Rng } from '../rng.js';
import type { Landmark } from '../types.js';
import type { Vec3 } from '../vec.js';

export interface Found {
  type: string;
  pos: Vec3;
}

/** What a scan saw within the scan radius of a candidate. */
export interface Evidence {
  entities: readonly Found[];
  blocks: readonly Found[];
}

/** Vanilla block ids the scan looks for (the adapter's include filter). */
export const LANDMARK_BLOCKS: readonly string[] = [
  BLOCK.bell, BLOCK.chiseledSandstone, BLOCK.orangeTerracotta, BLOCK.cryingObsidian,
];

const firstOf = (list: readonly Found[], types: readonly string[]): Found | undefined => (
  list.find((f) => types.includes(f.type)));

/** The landmark the evidence shows, in the spec's order (village, outpost, temple, portal). */
export function detectLandmark(evidence: Evidence): Landmark | undefined {
  const { entities, blocks } = evidence;
  const village = firstOf(entities, [ENTITY.villager, ENTITY.ironGolem])
    ?? firstOf(blocks, [BLOCK.bell]);
  if (village) return { kind: 'village', pos: village.pos };
  const outpost = firstOf(entities, [ENTITY.pillager]);
  if (outpost) return { kind: 'outpost', pos: outpost.pos };
  const chiseled = firstOf(blocks, [BLOCK.chiseledSandstone]);
  if (chiseled && firstOf(blocks, [BLOCK.orangeTerracotta])) {
    return { kind: 'desert temple', pos: chiseled.pos };
  }
  const portal = firstOf(blocks, [BLOCK.cryingObsidian]);
  return portal ? { kind: 'ruined portal', pos: portal.pos } : undefined;
}

/** Spots 20-30 blocks from the landmark in random directions; the caller checks the ground. */
export function offsetCandidates(landmark: Vec3, rng: Rng, count: number): Vec3[] {
  const { min, max } = LANDMARK.offset;
  return Array.from({ length: count }, () => {
    const angle = rng.range(0, Math.PI * 2);
    const dist = rng.range(min, max);
    const spotAt = (d: number): Vec3 => ({
      x: Math.round(landmark.x + Math.cos(angle) * d),
      y: landmark.y,
      z: Math.round(landmark.z + Math.sin(angle) * d),
    });
    const inRing = (s: Vec3): boolean => {
      const d = Math.hypot(s.x - landmark.x, s.z - landmark.z);
      return d >= min && d <= max;
    };
    // Rounding to whole blocks can land just outside the ring; nudge the distance back in.
    return [dist, dist + 1, dist - 1].map(spotAt).find(inRing) ?? spotAt((min + max) / 2);
  });
}
