// Ground walk and classification (spec §6.2): pure rules over block ids.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BLOCK, TERRAIN_BLOCKS, TERRAINS } from '../src/core/config.js';
import { assess, classify, groundOf } from '../src/core/course/terrain.js';

import type { Ground } from '../src/core/course/terrain.js';

/** A column of blocks from the top down: ids[0] is at y = top. */
const column = (top: number, ids: readonly string[]) => (y: number): string | undefined => (
  ids[top - y]);

const ground = (over: Partial<Ground> = {}): Ground => ({
  y: 70, id: BLOCK.grassBlock, forest: false, snow: false, ...over,
});

test('the ground walk skips air, plants, leaves and logs, and notes a forest', () => {
  const ids = [
    'minecraft:air', 'minecraft:oak_leaves', 'minecraft:oak_log', 'minecraft:short_grass',
    BLOCK.grassBlock,
  ];
  assert.deepEqual(groundOf(74, column(74, ids)), {
    y: 70, id: BLOCK.grassBlock, forest: true, snow: false,
  });
});

test('plants alone do not make a forest', () => {
  const g = groundOf(65, column(65, ['minecraft:tall_grass', 'minecraft:fern', BLOCK.dirt]));
  assert.deepEqual(g, {
    y: 63, id: BLOCK.dirt, forest: false, snow: false,
  });
});

test('snow layers are walked through and remembered', () => {
  const g = groundOf(80, column(80, [BLOCK.snowLayer, BLOCK.grassBlock]));
  assert.deepEqual(g, {
    y: 79, id: BLOCK.grassBlock, forest: false, snow: true,
  });
});

test('a lily pad is walked past, so a pond under it is rejected as water', () => {
  const g = groundOf(63, column(63, [BLOCK.waterlily, 'minecraft:water', BLOCK.sand]));
  assert.equal(g?.liquid, true);
});

test('a cactus is walked past and the sand under it makes a desert', () => {
  const g = groundOf(66, column(66, [BLOCK.cactus, BLOCK.cactus, BLOCK.sand]));
  assert.ok(g);
  assert.equal(g.y, 64);
  assert.equal(classify(g), 'desert');
});

test('water and lava are ground the walk stops on, and are marked liquid', () => {
  assert.equal(groundOf(62, column(62, ['minecraft:water', BLOCK.sand]))?.liquid, true);
  assert.equal(groundOf(30, column(30, ['minecraft:lava', BLOCK.stone]))?.liquid, true);
});

test('the walk gives up without ground within its depth, or when unloaded', () => {
  const airOnly = (): string => 'minecraft:air';
  assert.equal(groundOf(100, airOnly), undefined);
  assert.equal(groundOf(100, () => undefined), undefined);
});

test('every ground block in the tables classifies as its own terrain', () => {
  for (const terrain of TERRAINS) {
    for (const id of TERRAIN_BLOCKS[terrain]) {
      assert.equal(classify(ground({ id })), terrain, `${id} should be ${terrain}`);
    }
  }
});

test('markers beat the block under them: leaves or logs mean forest, snow means snowy', () => {
  assert.equal(classify(ground({ forest: true })), 'forest');
  assert.equal(classify(ground({ snow: true })), 'snowy');
  assert.equal(classify(ground({ forest: true, snow: true })), 'snowy');
});

test('an unlisted ground block classifies as plains', () => {
  assert.equal(classify(ground({ id: BLOCK.dirt })), 'plains');
});

const level = (y: number, over: Partial<Ground> = {}): Ground => ground({ y, ...over });

test('a flat site is accepted with its terrain, height and spread', () => {
  const out = assess(level(70), [level(70), level(71), level(70), level(72)]);
  assert.deepEqual(out, {
    ok: true, terrain: 'plains', y: 70, spread: 2,
  });
});

test('a centre in water or lava is rejected', () => {
  const out = assess(level(62, { liquid: true }), [level(62), level(62), level(62), level(62)]);
  assert.deepEqual(out, { ok: false, reason: 'liquid' });
});

test('a spread of more than 6 blocks is rejected; exactly 6 is accepted', () => {
  assert.equal(assess(level(70), [level(70), level(77), level(70), level(70)]).ok, false);
  assert.equal(assess(level(70), [level(70), level(76), level(70), level(70)]).ok, true);
  assert.deepEqual(
    assess(level(70), [level(70), level(77), level(70), level(70)]),
    { ok: false, reason: 'rough' },
  );
});

test('an arm that has no ground (unloaded) rejects the site', () => {
  assert.deepEqual(assess(level(70), [level(70), undefined, level(70), level(70)]), {
    ok: false, reason: 'noGround',
  });
  assert.deepEqual(assess(undefined, []), { ok: false, reason: 'noGround' });
});
