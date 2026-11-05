// Candidate scan (spec §6.1-6.3): load the area around a candidate, check the ground, look for
// a landmark and, if one is there, move the arena to flat ground 20-30 blocks from it. The world
// sits behind AreaLoader, so this is tested with a fake area; the adapter loads real chunks.
/* eslint-disable no-await-in-loop -- spots are tried in order, one load at a time */
import { LANDMARK, TERRAIN_PROBE } from '../config.js';
import { Rng } from '../rng.js';
import { detectLandmark, offsetCandidates } from './landmarks.js';
import { assess } from './terrain.js';
import { TIMEOUT } from './walk.js';

import type { Evidence } from './landmarks.js';
import type { Ground } from './terrain.js';
import type { Answer, Probe } from './walk.js';
import type { Vec3 } from '../vec.js';

export type { Evidence } from './landmarks.js';

/** A loaded stretch of world around a candidate. */
export interface Area {
  /** The ground at x, z (topmost block, walked down), undefined if it is not loaded. */
  groundAt: (x: number, z: number) => Ground | undefined;
  /** Entities and landmark blocks within the scan radius. */
  evidence: () => Evidence;
}

export interface AreaLoader {
  /** Loads the area around `pos`; undefined when it did not load in time. */
  load: (pos: Vec3) => Promise<Area | undefined>;
}

type Site = Pick<Probe, 'terrain' | 'spread'> & { y: number };

function assessAt(area: Area, x: number, z: number): Site | undefined {
  const { arm } = TERRAIN_PROBE;
  const arms = [[arm, 0], [-arm, 0], [0, arm], [0, -arm]] as const;
  const result = assess(area.groundAt(x, z), arms.map(([dx, dz]) => area.groundAt(x + dx, z + dz)));
  return result.ok ? result : undefined;
}

/** Probes one candidate; undefined rejects it (water or rough ground), TIMEOUT: it did not load. */
export async function scanCandidate(
  pos: Vec3,
  loader: AreaLoader,
  seed: number,
): Promise<Answer> {
  const area = await loader.load(pos);
  if (!area) return TIMEOUT;
  const site = assessAt(area, pos.x, pos.z);
  if (!site) return undefined;
  const probe: Probe = {
    pos: { x: pos.x, y: site.y, z: pos.z }, terrain: site.terrain, spread: site.spread,
  };
  const landmark = detectLandmark(area.evidence());
  if (!landmark) return probe;

  const rng = new Rng(Math.abs(seed + pos.x * 73856093 + pos.z * 19349663) % 0x100000000);
  const spots = offsetCandidates(landmark.pos, rng, LANDMARK.offsetTries);
  for (const spot of spots) {
    // Each spot may lie outside the loaded area, so it is loaded in turn.
    const moved = await loader.load(spot);
    const movedSite = moved && assessAt(moved, spot.x, spot.z);
    if (movedSite) {
      return {
        pos: { x: spot.x, y: movedSite.y, z: spot.z },
        terrain: movedSite.terrain,
        spread: movedSite.spread,
        landmark,
      };
    }
  }
  return probe;
}
