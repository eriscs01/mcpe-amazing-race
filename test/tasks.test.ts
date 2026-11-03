// The physical task kinds (spec §7.1): the blocks they build, their progress and completion.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ARENA, BLOCK } from '../src/core/config.js';
import { Rng } from '../src/core/rng.js';
import { archery, archeryTargets } from '../src/core/tasks/archery.js';
import { haystack } from '../src/core/tasks/haystack.js';
import { parkour, parkourCourse } from '../src/core/tasks/parkour.js';

import type { TaskContext } from '../src/core/tasks/kind.js';
import type { Op } from '../src/core/types.js';
import type { Vec3 } from '../src/core/vec.js';

const stop = {
  id: 2,
  leg: 1,
  type: 'detour' as const,
  pos: { x: 100, y: 70, z: -20 },
  terrain: 'plains' as const,
  name: 'Place 2',
  blind: false,
  built: true,
  lit: false,
};
const ctxOf = (over: Partial<TaskContext> = {}): TaskContext => ({
  stop,
  zone: 'A',
  centre: { x: 94, y: 70, z: -20 },
  leg: 1,
  teams: 3,
  hidden: [],
  label: 'Aim',
  ...over,
});
const inArena = (p: { x: number; z: number }): boolean => Math.abs(p.x - stop.pos.x) <= ARENA.half
  && Math.abs(p.z - stop.pos.z) <= ARENA.half;

const sets = (ops: Op[]): Extract<Op, { kind: 'set' }>[] => ops.filter(
  (o): o is Extract<Op, { kind: 'set' }> => o.kind === 'set',
);

test('archery: six targets on the zone wall at the spec offsets, inside the arena', () => {
  const west = archeryTargets(ctxOf());
  assert.deepEqual(west.map((t) => t.z - stop.pos.z), [-6, -4, -1, 1, 4, 6]);
  assert.ok(west.every((t) => t.x === stop.pos.x - 9));
  assert.ok(west.every((t) => t.y >= 72 && t.y <= 74));
  assert.ok(west.every(inArena));
  const east = archeryTargets(ctxOf({ zone: 'B' }));
  assert.ok(east.every((t) => t.x === stop.pos.x + 9));
  const { ops } = archery.build(ctxOf(), new Rng(1));
  assert.deepEqual(sets(ops).map((o) => o.block), Array(6).fill(BLOCK.target));
});

test('archery: counts distinct targets from at least 8 blocks, 4 early and 5 from leg 3', () => {
  const [first] = archeryTargets(ctxOf());
  if (!first) throw new Error('no target');
  const far = { x: first.x + 12, y: 71, z: first.z };
  const hit = (p: Record<string, number>, shooter = far, block = first) => archery.onEvent(
    p,
    { type: 'projectileHit', block, shooter },
    ctxOf(),
  );
  const once = hit(archery.initial);
  assert.deepEqual(once, { hits: 1 });
  assert.deepEqual(hit(once), once, 'the same target counts once');
  assert.equal(
    hit(archery.initial, { ...far, x: first.x + 7.9 }),
    archery.initial,
    'closer than 8 blocks does not count',
  );
  assert.equal(
    hit(archery.initial, far, { ...first, y: first.y + 20 }),
    archery.initial,
    'a block that is not a target does not count',
  );
  assert.equal(archery.done({ hits: 0b001111 }, ctxOf()), true);
  assert.equal(archery.done({ hits: 0b000111 }, ctxOf()), false);
  assert.equal(archery.done({ hits: 0b001111 }, ctxOf({ leg: 3 })), false);
  assert.equal(archery.done({ hits: 0b011111 }, ctxOf({ leg: 3 })), true);
  assert.equal(archery.progressText({ hits: 0b000101 }, ctxOf()), 'Aim: targets 2/4');
  assert.equal(archery.progressText({ hits: 0 }, ctxOf({ leg: 4 })), 'Aim: targets 0/5');
});

test('archery: gives a bow and 24 arrows', () => {
  const effects = archery.equip(ctxOf(), ['h', 'b']);
  assert.deepEqual(
    effects.map((e) => (e.kind === 'giveVanilla' ? [e.to, e.item, e.count] : [])),
    [['h', 'minecraft:bow', 1], ['h', 'minecraft:arrow', 24],
      ['b', 'minecraft:bow', 1], ['b', 'minecraft:arrow', 24]],
  );
});

test('parkour: 8 jumps with 1-block gaps (6 with 2-block gaps from leg 3), rising', () => {
  const early = parkourCourse(ctxOf({ label: 'Climb' }));
  assert.equal(early.platforms.length, 8);
  assert.deepEqual(early.platforms.map((p) => p.y - 71), [0, 0, 1, 1, 2, 2, 3, 3]);
  const zs = early.platforms.map((p) => p.z);
  assert.ok(zs.every((z, i) => i === 0 || z - (zs[i - 1] ?? 0) === 2), '1-block gaps');
  const late = parkourCourse(ctxOf({ leg: 3 }));
  assert.equal(late.platforms.length, 6);
  const lz = late.platforms.map((p) => p.z);
  assert.ok(lz.every((z, i) => i === 0 || z - (lz[i - 1] ?? 0) === 3), '2-block gaps');
  for (const course of [early, late]) {
    assert.ok(course.platforms.every(inArena));
    assert.deepEqual(course.gold, course.platforms.at(-1));
  }
});

test('parkour: white concrete platforms ending in one gold block; done when standing on it', () => {
  const ctx = ctxOf({ label: 'Climb' });
  const { ops } = parkour.build(ctx, new Rng(1));
  const blocks = sets(ops).map((o) => o.block);
  assert.equal(blocks.filter((b) => b === BLOCK.goldBlock).length, 1);
  assert.equal(blocks.filter((b) => b === BLOCK.whiteConcrete).length, 7);
  const { gold } = parkourCourse(ctx);
  const stand = (x: number, y: number, z: number) => parkour.onEvent(
    parkour.initial,
    { type: 'standing', pos: { x, y, z } },
    ctx,
  );
  const won = stand(gold.x + 0.5, gold.y + 1, gold.z + 0.5);
  assert.equal(parkour.done(won, ctx), true);
  assert.equal(parkour.done(stand(gold.x + 3.5, gold.y + 1, gold.z + 0.5), ctx), false);
  const above = stand(gold.x + 0.5, gold.y + 3, gold.z + 0.5);
  assert.equal(parkour.done(above, ctx), false, 'in the air above');
  assert.equal(parkour.done(stand(gold.x + 0.5, gold.y - 1, gold.z + 0.5), ctx), false, 'below it');
  assert.equal(parkour.progressText(parkour.initial, ctx), 'Climb: reach the gold block');
});

test('haystack: a 5×5×3 pile with one wool per team (max 9) hidden in the middle layer', () => {
  const { ops, hidden } = haystack.build(ctxOf({ label: 'Find' }), new Rng(7));
  assert.equal(hidden?.length, 3);
  const centre = { x: 94, y: 70, z: -20 };
  for (const h of hidden ?? []) {
    assert.equal(h.y, centre.y + 2, 'middle layer');
    assert.ok(Math.abs(h.x - centre.x) <= 1 && Math.abs(h.z - centre.z) <= 1, 'interior 3×3');
  }
  assert.equal(new Set((hidden ?? []).map((h) => `${h.x},${h.z}`)).size, 3, 'distinct');
  const fill = ops.find((o) => o.kind === 'fill');
  assert.deepEqual(fill, {
    kind: 'fill',
    from: { x: 92, y: 71, z: -22 },
    to: { x: 96, y: 73, z: -18 },
    block: BLOCK.hayBlock,
  });
  assert.equal(sets(ops).filter((o) => o.block === BLOCK.yellowWool).length, 3);
  const many = haystack.build(ctxOf({ teams: 14 }), new Rng(7)).hidden;
  assert.equal(many?.length, 9);
});

test('haystack: breaking a hidden wool completes it; other blocks and bare wool do not', () => {
  const wool = { x: 94, y: 72, z: -20 };
  const ctx = ctxOf({ hidden: [wool, { x: 95, y: 72, z: -19 }], label: 'Find' });
  const broke = (id: string, block: Vec3 = wool) => haystack.onEvent(
    haystack.initial,
    { type: 'blockBroken', block, id },
    ctx,
  );
  assert.equal(haystack.done(broke(BLOCK.yellowWool), ctx), true);
  assert.equal(haystack.done(broke(BLOCK.hayBlock), ctx), false);
  assert.equal(haystack.done(broke(BLOCK.yellowWool, { x: 90, y: 72, z: -20 }), ctx), false);
  assert.equal(haystack.progressText(haystack.initial, ctx), 'Find: dig for the hidden wool');
});
