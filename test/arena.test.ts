// Arena layout (spec §6.5): the operations that build a stop, applied to a fake block grid;
// lighting (§6.6); where the zones lie; and how an existing arena is recognised (#32).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BlockGrid } from './helpers/blockGrid.js';
import {
  applyOps, buildOps, lightOps, looksBuilt, zonesFor,
} from '../src/core/arena/layout.js';
import { ARENA, BLOCK } from '../src/core/config.js';

import type { StopType } from '../src/core/types.js';

const G = 64;
/** Runs a build to the end; returns the number of times it yielded. */
const run = (steps: Generator<void>): number => [...steps].length;
const site = (type: StopType = 'route', x = 100, z = -40) => ({ pos: { x, y: G, z }, type });

function built(type: StopType = 'route', grid = new BlockGrid(G)): BlockGrid {
  const s = site(type);
  run(applyOps(grid, buildOps(s)));
  return grid;
}

test('the arena is cleared to air from g+1 to g+14, whatever stood there', () => {
  const grid = new BlockGrid(G);
  grid.put(95, G + 5, -45, BLOCK.cactus);
  grid.put(109, G + 14, -31, BLOCK.vine);
  built('route', grid);
  assert.equal(grid.idAt(95, G + 5, -45), BLOCK.air);
  assert.equal(grid.idAt(109, G + 14, -31), BLOCK.air);
});

test('only air and water below the floor become dirt; solid ground is left alone', () => {
  const grid = new BlockGrid(G, BLOCK.stone);
  grid.put(100, G - 1, -40, BLOCK.air);
  grid.put(101, G - 2, -40, BLOCK.water);
  grid.put(102, G - 2, -40, BLOCK.flowingWater);
  built('route', grid);
  assert.equal(grid.idAt(100, G - 1, -40), BLOCK.dirt);
  assert.equal(grid.idAt(101, G - 2, -40), BLOCK.dirt);
  assert.equal(grid.idAt(102, G - 2, -40), BLOCK.dirt);
  assert.equal(grid.idAt(103, G - 1, -40), BLOCK.stone);
  assert.equal(grid.idAt(100, G - 3, -40), BLOCK.stone);
});

test('the floor is 19 by 19 smooth stone at g, the beacon base aside', () => {
  const grid = built();
  const stone = grid.count(BLOCK.smoothStone);
  assert.equal(stone, ARENA.size * ARENA.size - 9);
  assert.equal(grid.idAt(91, G, -49), BLOCK.smoothStone);
  assert.equal(grid.idAt(109, G, -31), BLOCK.smoothStone);
  assert.equal(grid.idAt(110, G, -31), BLOCK.grassBlock);
});

test('the beacon base is a 3 by 3 of iron at g, with the unlit clue box above its centre', () => {
  const grid = built();
  assert.equal(grid.count(BLOCK.ironBlock), 9);
  assert.equal(grid.idAt(99, G, -41), BLOCK.ironBlock);
  assert.equal(grid.idAt(101, G, -39), BLOCK.ironBlock);
  assert.equal(grid.idAt(100, G + 1, -40), BLOCK.yellowConcrete);
  assert.equal(grid.idAt(100, G + 2, -40), BLOCK.air);
});

test('the column above the beacon is cleared up to the topmost block', () => {
  const grid = new BlockGrid(G);
  for (let y = G + 1; y <= G + 40; y += 1) grid.put(100, y, -40, 'minecraft:oak_log');
  grid.put(100, G + 30, -41, 'minecraft:oak_leaves');
  built('route', grid);
  for (let y = G + 2; y <= G + 40; y += 1) {
    assert.equal(grid.idAt(100, y, -40), BLOCK.air, `y=${y}`);
  }
  assert.equal(grid.idAt(100, G + 1, -40), BLOCK.yellowConcrete);
  assert.equal(grid.idAt(100, G + 30, -41), 'minecraft:oak_leaves');
});

test('flags stand at the four corners: fence, red wool, yellow wool, lantern', () => {
  const grid = built();
  for (const [x = 0, z = 0] of [[91, -49], [109, -49], [91, -31], [109, -31]]) {
    assert.deepEqual(
      [1, 2, 3, 4, 5, 6].map((dy) => grid.idAt(x, G + dy, z)),
      [
        BLOCK.oakFence, BLOCK.oakFence, BLOCK.oakFence,
        BLOCK.redWool, BLOCK.yellowWool, BLOCK.lantern,
      ],
    );
  }
});

test('torches stand every 4 blocks along the floor edge', () => {
  const grid = built();
  assert.equal(grid.count(BLOCK.torch), 20);
  for (const off of [-8, -4, 0, 4, 8]) {
    assert.equal(grid.idAt(100 + off, G + 1, -49), BLOCK.torch);
    assert.equal(grid.idAt(100 + off, G + 1, -31), BLOCK.torch);
    assert.equal(grid.idAt(91, G + 1, -40 + off), BLOCK.torch);
    assert.equal(grid.idAt(109, G + 1, -40 + off), BLOCK.torch);
  }
});

test('only Pit Stop and Finish get the red and yellow checker mat south of the centre', () => {
  for (const type of ['pit', 'finish'] as const) {
    const grid = built(type);
    const ids = [-1, 0, 1].flatMap((dx) => (
      [-1, 0, 1].map((dz) => grid.idAt(100 + dx, G, -34 + dz))));
    assert.deepEqual(ids, [
      BLOCK.redConcrete, BLOCK.yellowConcrete, BLOCK.redConcrete,
      BLOCK.yellowConcrete, BLOCK.redConcrete, BLOCK.yellowConcrete,
      BLOCK.redConcrete, BLOCK.yellowConcrete, BLOCK.redConcrete,
    ]);
  }
  const route = built('route');
  assert.equal(route.idAt(100, G, -34), BLOCK.smoothStone);
});

test('lighting a stop turns the clue box into a beacon under a glass block of its colour', () => {
  const colours: [StopType, string][] = [
    ['start', BLOCK.whiteStainedGlass], ['route', BLOCK.yellowStainedGlass],
    ['detour', BLOCK.yellowStainedGlass], ['roadblock', BLOCK.redStainedGlass],
    ['pit', BLOCK.limeStainedGlass], ['finish', BLOCK.limeStainedGlass],
  ];
  for (const [type, glass] of colours) {
    const grid = built(type);
    run(applyOps(grid, lightOps(site(type), true)));
    assert.equal(grid.idAt(100, G + 1, -40), BLOCK.beacon, type);
    assert.equal(grid.idAt(100, G + 2, -40), glass, type);
  }
});

test('unlighting restores yellow concrete and removes the glass', () => {
  const grid = built();
  run(applyOps(grid, lightOps(site(), true)));
  run(applyOps(grid, lightOps(site(), false)));
  assert.equal(grid.idAt(100, G + 1, -40), BLOCK.yellowConcrete);
  assert.equal(grid.idAt(100, G + 2, -40), BLOCK.air);
});

test('the build yields between operations so a job never holds a tick', () => {
  assert.ok(run(applyOps(new BlockGrid(G), buildOps(site()))) > 3);
});

test('fills stay inside the world height', () => {
  const grid = new BlockGrid(G);
  const tall = { pos: { x: 0, y: grid.maxY - 5, z: 0 }, type: 'route' as StopType };
  run(applyOps(grid, buildOps(tall)));
  assert.equal(grid.idAt(0, grid.maxY, 0), BLOCK.air);
  assert.equal(grid.idAt(0, tall.pos.y, 0), BLOCK.ironBlock);
  assert.ok([...grid.blocks.keys()].every((k) => Number(k.split(',')[1]) <= grid.maxY));
});

test('zones: Detour has A west and B east, Roadblock only A, the rest none', () => {
  const at = { x: 100, y: G, z: -40 };
  assert.deepEqual(zonesFor('detour', at), [
    { zone: 'A', centre: { x: 94, y: G, z: -40 } },
    { zone: 'B', centre: { x: 106, y: G, z: -40 } },
  ]);
  assert.deepEqual(zonesFor('roadblock', at), [{ zone: 'A', centre: { x: 94, y: G, z: -40 } }]);
  for (const type of ['start', 'route', 'pit', 'finish'] as const) {
    assert.deepEqual(zonesFor(type, at), []);
  }
});

// ── Recognising an arena that is already there (#32) ────────────────────────

const idsOf = (grid: BlockGrid) => (x: number, y: number, z: number) => grid.idAt(x, y, z);

test('a finished arena, lit or unlit, is recognised at its real ground height', () => {
  const grid = built();
  assert.equal(looksBuilt(idsOf(grid), site().pos), G);
  run(applyOps(grid, lightOps(site(), true)));
  assert.equal(looksBuilt(idsOf(grid), site().pos), G);
});

test('a re-run probe reads the old clue box or glass as ground; the real height is found', () => {
  const grid = built();
  assert.equal(looksBuilt(idsOf(grid), { x: 100, y: G + 1, z: -40 }), G);
  run(applyOps(grid, lightOps(site(), true)));
  assert.equal(looksBuilt(idsOf(grid), { x: 100, y: G + 2, z: -40 }), G);
});

test('natural ground is not an arena', () => {
  assert.equal(looksBuilt(idsOf(new BlockGrid(G)), site().pos), undefined);
});

test('an unfinished build never reads as built: the clue box is placed last', () => {
  const ops = buildOps(site());
  for (let n = 0; n < ops.length; n += 1) {
    const grid = new BlockGrid(G);
    run(applyOps(grid, ops.slice(0, n)));
    assert.equal(looksBuilt(idsOf(grid), site().pos), undefined, `after ${n} of ${ops.length}`);
  }
});

test('a block that is not loaded reads as no arena', () => {
  assert.equal(looksBuilt(() => undefined, site().pos), undefined);
});
