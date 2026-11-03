// Landmark detection and arena offset (spec §6.3).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BLOCK, ENTITY } from '../src/core/config.js';
import { detectLandmark, offsetCandidates } from '../src/core/course/landmarks.js';
import { Rng } from '../src/core/rng.js';
import { horizontalDistance } from '../src/core/vec.js';

const at = (x: number, z: number) => ({ x, y: 70, z });

test('villagers, iron golems or a bell mean a village', () => {
  assert.deepEqual(
    detectLandmark({ entities: [{ type: ENTITY.villager, pos: at(5, 5) }], blocks: [] }),
    { kind: 'village', pos: at(5, 5) },
  );
  assert.equal(
    detectLandmark({ entities: [{ type: ENTITY.ironGolem, pos: at(1, 1) }], blocks: [] })?.kind,
    'village',
  );
  assert.deepEqual(
    detectLandmark({ entities: [], blocks: [{ type: BLOCK.bell, pos: at(9, 9) }] }),
    { kind: 'village', pos: at(9, 9) },
  );
});

test('pillagers mean an outpost', () => {
  assert.equal(
    detectLandmark({ entities: [{ type: ENTITY.pillager, pos: at(2, 2) }], blocks: [] })?.kind,
    'outpost',
  );
});

test('a desert temple needs both chiseled sandstone and orange terracotta', () => {
  const chiseled = { type: BLOCK.chiseledSandstone, pos: at(3, 3) };
  const orange = { type: BLOCK.orangeTerracotta, pos: at(4, 3) };
  assert.deepEqual(detectLandmark({ entities: [], blocks: [chiseled, orange] }), {
    kind: 'desert temple', pos: at(3, 3),
  });
  assert.equal(detectLandmark({ entities: [], blocks: [chiseled] }), undefined);
  assert.equal(detectLandmark({ entities: [], blocks: [orange] }), undefined);
});

test('crying obsidian means a ruined portal', () => {
  assert.deepEqual(
    detectLandmark({ entities: [], blocks: [{ type: BLOCK.cryingObsidian, pos: at(7, 1) }] }),
    { kind: 'ruined portal', pos: at(7, 1) },
  );
});

test('nothing found is no landmark; village wins over the others', () => {
  assert.equal(detectLandmark({ entities: [], blocks: [] }), undefined);
  assert.equal(detectLandmark({
    entities: [{ type: ENTITY.pillager, pos: at(0, 0) }, { type: ENTITY.villager, pos: at(1, 1) }],
    blocks: [{ type: BLOCK.cryingObsidian, pos: at(2, 2) }],
  })?.kind, 'village');
});

test('offset candidates lie 20 to 30 blocks from the landmark, never on it', () => {
  const landmark = at(100, -40);
  const list = offsetCandidates(landmark, new Rng(3), 12);
  assert.equal(list.length, 12);
  for (const c of list) {
    const d = horizontalDistance(c, landmark);
    assert.ok(d >= 20 && d <= 30, `distance ${d}`);
  }
  assert.ok(new Set(list.map((c) => `${c.x},${c.z}`)).size > 6, 'candidates should differ');
});

test('offset candidates are reproducible for a seed', () => {
  const a = offsetCandidates(at(0, 0), new Rng(9), 5);
  const b = offsetCandidates(at(0, 0), new Rng(9), 5);
  assert.deepEqual(a, b);
});
