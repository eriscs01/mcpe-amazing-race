// Candidate scan (spec §6.1-6.3): load an area, check the ground, look for a landmark, and move
// the arena off a landmark. The world is a fake area; the adapter's ticking-area loader is real.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BLOCK, ENTITY } from '../src/core/config.js';
import { scanCandidate } from '../src/core/course/scan.js';
import { TIMEOUT } from '../src/core/course/walk.js';
import { horizontalDistance } from '../src/core/vec.js';

import type { Area, AreaLoader, Evidence } from '../src/core/course/scan.js';
import type { Ground } from '../src/core/course/terrain.js';
import type { Probe } from '../src/core/course/walk.js';
import type { Vec3 } from '../src/core/vec.js';

interface World {
  /** Ground block and height at x, z; undefined = unloaded. */
  at: (x: number, z: number) => { id: string; y: number } | undefined;
  evidence?: (centre: Vec3) => Evidence;
}

const flatWorld: World = { at: () => ({ id: BLOCK.grassBlock, y: 70 }) };

class FakeLoader implements AreaLoader {
  loads: Vec3[] = [];

  constructor(private readonly world: World, private readonly times: 'ok' | 'timeout' = 'ok') {}

  async load(pos: Vec3): Promise<Area | undefined> {
    this.loads.push(pos);
    if (this.times === 'timeout') return undefined;
    const { world } = this;
    return {
      groundAt: (x, z) => {
        const g = world.at(x, z);
        if (!g) return undefined;
        const ground: Ground = { ...g, forest: false, snow: false };
        if (g.id === 'minecraft:water') ground.liquid = true;
        return ground;
      },
      evidence: () => world.evidence?.(pos) ?? { entities: [], blocks: [] },
    };
  }
}

/** The probe, with a timeout read as a rejection. */
const scanned = async (...args: Parameters<typeof scanCandidate>): Promise<Probe | undefined> => {
  const answer = await scanCandidate(...args);
  return answer === TIMEOUT ? undefined : answer;
};

const noEvidence: Evidence = { entities: [], blocks: [] };
const here = { x: 500, y: 64, z: 500 };

test('flat plains is accepted at the asked position with its height', async () => {
  const probe = await scanned(here, new FakeLoader(flatWorld), 1);
  assert.deepEqual(probe, {
    pos: { x: 500, y: 70, z: 500 }, terrain: 'plains', spread: 0,
  });
});

test('terrain comes from the ground block', async () => {
  const sand: World = { at: () => ({ id: BLOCK.sand, y: 70 }) };
  assert.equal((await scanned(here, new FakeLoader(sand), 1))?.terrain, 'desert');
});

test('samples the centre and 6 blocks out on each axis', async () => {
  const seen: string[] = [];
  const world: World = {
    at: (x, z) => {
      seen.push(`${x - 500},${z - 500}`);
      return { id: BLOCK.grassBlock, y: 70 };
    },
  };
  await scanned(here, new FakeLoader(world), 1);
  assert.deepEqual([...new Set(seen)].sort(), ['-6,0', '0,-6', '0,0', '0,6', '6,0']);
});

test('a timeout (area never loaded) is reported as TIMEOUT, not as a rejection', async () => {
  assert.equal(await scanCandidate(here, new FakeLoader(flatWorld, 'timeout'), 1), TIMEOUT);
});

test('water or rough ground rejects the candidate', async () => {
  const lake: World = { at: () => ({ id: 'minecraft:water', y: 62 }) };
  assert.equal(await scanned(here, new FakeLoader(lake), 1), undefined);
  const cliff: World = { at: (x) => ({ id: BLOCK.stone, y: x > 502 ? 90 : 70 }) };
  assert.equal(await scanned(here, new FakeLoader(cliff), 1), undefined);
});

const villageAt = (c: Vec3): Evidence => ({
  entities: [{ type: ENTITY.villager, pos: { x: c.x + 10, y: 70, z: c.z } }],
  blocks: [],
});
const onlyAtHere = (c: Vec3): Evidence => (c.x === 500 ? villageAt(c) : noEvidence);

test('a landmark moves the arena 20-30 blocks off it and tags the probe', async () => {
  const village = { x: 510, y: 70, z: 500 };
  const loader = new FakeLoader({
    ...flatWorld,
    evidence: (c) => (
      c.x === 500 ? villageAt(c) : { entities: [], blocks: [] }),
  });
  const probe = await scanned(here, loader, 1);
  assert.ok(probe?.landmark);
  assert.deepEqual(probe.landmark, { kind: 'village', pos: village });
  const d = horizontalDistance(probe.pos, village);
  assert.ok(d >= 20 && d <= 30, `distance ${d}`);
});

test('if no offset spot is usable the candidate stays, without the landmark', async () => {
  const world: World = {
    at: (x, z) => (Math.hypot(x - 510, z - 500) < 17
      ? { id: BLOCK.grassBlock, y: 70 }
      : { id: 'minecraft:water', y: 62 }),
    evidence: villageAt,
  };
  const probe = await scanned(here, new FakeLoader(world), 1);
  assert.equal(probe?.landmark, undefined);
  assert.equal(probe?.pos.x, 500);
});

test('scanning is reproducible for a seed', async () => {
  const world: World = { ...flatWorld, evidence: onlyAtHere };
  const a = await scanned(here, new FakeLoader(world), 4);
  const b = await scanned(here, new FakeLoader(world), 4);
  assert.deepEqual(a, b);
});
