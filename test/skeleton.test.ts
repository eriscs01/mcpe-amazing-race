// Course skeleton (spec §5, §6.4, §7.3): the stop order of every leg, blind segments, which
// challenge each Detour and Roadblock gets, and where host-pinned waypoints go.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DETOUR_PAIRS } from '../src/core/config.js';
import {
  assignPins, nearestNeighbourOrder, pinProblem, skeleton,
} from '../src/core/course/skeleton.js';

import type { Slot } from '../src/core/course/skeleton.js';
import type { TaskSpec } from '../src/core/types.js';

const SEEDS = Array.from({ length: 40 }, (_, i) => i * 7919 + 1);

const shape = (slots: readonly Slot[]): string[] => slots.map((s) => `${s.leg}:${s.type}`);

const detourNames = (task: TaskSpec | undefined): string => {
  if (task?.type !== 'detour') return '';
  return task.options.map((o) => o.name).join('/');
};

const kindsOf = (task: TaskSpec | undefined): string[] => {
  if (task?.type === 'detour') return task.options.map((o) => o.kind);
  return task?.type === 'roadblock' ? [task.kind] : [];
};

test('each leg is Route Info, Detour, Roadblock, Pit Stop; the last leg ends at the Finish', () => {
  const slots = skeleton({ legs: 3, peaceful: false, seed: 1 });
  assert.deepEqual(shape(slots), [
    '0:start',
    '1:route', '1:detour', '1:roadblock', '1:pit',
    '2:route', '2:detour', '2:roadblock', '2:pit',
    '3:route', '3:roadblock', '3:detour', '3:finish',
  ]);
});

test('a course has 4 × legs + 1 stops before any are inserted', () => {
  for (let legs = 2; legs <= 12; legs += 1) {
    assert.equal(skeleton({ legs, peaceful: false, seed: 1 }).length, 4 * legs + 1, `${legs}`);
  }
});

test('from leg 2 on, the segment into each leg\'s Detour is blind', () => {
  const slots = skeleton({ legs: 4, peaceful: false, seed: 1 });
  assert.deepEqual(
    slots.filter((s) => s.blind).map((s) => `${s.leg}:${s.type}`),
    ['2:detour', '3:detour', '4:detour'],
  );
});

test('only Detours and Roadblocks carry a challenge', () => {
  for (const s of skeleton({ legs: 6, peaceful: false, seed: 3 })) {
    const expected = s.type === 'detour' || s.type === 'roadblock' ? s.type : undefined;
    assert.equal(s.task?.type, expected, `${s.leg}:${s.type}`);
  }
});

test('Detour options come in the spec\'s pairs, never the same pair twice in a row', () => {
  const pairs = new Set(DETOUR_PAIRS.map((p) => `${p.a.name}/${p.b.name}`));
  for (const seed of SEEDS) {
    const detours = skeleton({ legs: 12, peaceful: false, seed })
      .filter((s) => s.type === 'detour').map((s) => detourNames(s.task));
    for (const [i, name] of detours.entries()) {
      assert.ok(pairs.has(name), name);
      assert.notEqual(name, detours[i - 1], `seed ${seed}, detour ${i}`);
    }
  }
});

test('Roadblocks never repeat the previous kind; the final leg\'s is always Recall', () => {
  for (const seed of SEEDS) {
    const kinds = skeleton({ legs: 12, peaceful: false, seed })
      .filter((s) => s.type === 'roadblock').flatMap((s) => kindsOf(s.task));
    assert.equal(kinds.at(-1), 'recall');
    assert.ok(!kinds.slice(0, -1).includes('recall'));
    for (const [i, kind] of kinds.entries()) assert.notEqual(kind, kinds[i - 1], `seed ${seed}`);
  }
});

test('every pair and Roadblock kind turns up across courses', () => {
  const seen = new Set<string>();
  for (const seed of SEEDS) {
    for (const s of skeleton({ legs: 12, peaceful: false, seed })) {
      if (s.task?.type === 'detour') seen.add(detourNames(s.task));
      if (s.task?.type === 'roadblock') seen.add(s.task.kind);
    }
  }
  assert.equal(seen.size, DETOUR_PAIRS.length + 6);
});

test('on Peaceful, no Detour option or Roadblock is a hunt', () => {
  for (const seed of SEEDS) {
    const kinds = skeleton({ legs: 12, peaceful: true, seed }).flatMap((s) => kindsOf(s.task));
    assert.ok(kinds.length > 0);
    assert.ok(!kinds.includes('hunt'), `seed ${seed}`);
  }
});

test('the same seed gives the same skeleton', () => {
  const input = { legs: 8, peaceful: false, seed: 99 };
  assert.deepEqual(skeleton(input), skeleton(input));
  assert.notDeepEqual(skeleton(input), skeleton({ ...input, seed: 100 }));
});

const start = { x: 0, y: 64, z: 0 };
const p = (x: number, z: number) => ({ x, y: 70, z });

test('pinned waypoints are visited in nearest-neighbour order from the start line', () => {
  const pins = [p(1000, 0), p(-400, 0), p(1000, 600), p(-400, 500)];
  assert.deepEqual(nearestNeighbourOrder(start, pins), [
    p(-400, 0), p(-400, 500), p(1000, 600), p(1000, 0),
  ]);
  assert.deepEqual(nearestNeighbourOrder(start, []), []);
});

test('pins become Detour or Roadblock stops, spread over the course in visiting order', () => {
  const slots = skeleton({ legs: 3, peaceful: false, seed: 1 });
  const pins = [p(1000, 0), p(-500, 0)];
  const pinned = assignPins(slots, start, pins);
  assert.deepEqual(shape(pinned), shape(slots));
  const at = pinned.flatMap((s, i) => (s.pin ? [[i, s.type, s.pin]] : []));
  // Six eligible slots (D, R × 3 legs); two pins land in the middle of each half.
  assert.deepEqual(at, [[3, 'roadblock', p(-500, 0)], [10, 'roadblock', p(1000, 0)]]);
  assert.deepEqual(assignPins(slots, start, []), slots);
});

test('every pin is used once, and each lands on a Detour or Roadblock', () => {
  const slots = skeleton({ legs: 2, peaceful: false, seed: 1 });
  const pins = [p(500, 0), p(1000, 0), p(1500, 0), p(2000, 0)];
  const pinned = assignPins(slots, start, pins).filter((s) => s.pin);
  assert.deepEqual(pinned.map((s) => s.pin), pins);
  assert.ok(pinned.every((s) => s.type === 'detour' || s.type === 'roadblock'));
});

test('pins outside the course, too close together or too many are reported', () => {
  const radius = 1400;
  const slots = skeleton({ legs: 2, peaceful: false, seed: 1 });
  assert.equal(pinProblem(start, [p(800, 0), p(-800, 0)], radius, slots), undefined);
  assert.deepEqual(pinProblem(start, [p(800, 0), p(1500, 0)], radius, slots), {
    reason: 'pinOutsideCourse', pin: 1,
  });
  assert.deepEqual(pinProblem(start, [p(200, 0)], radius, slots), {
    reason: 'pinTooClose', pin: 0,
  });
  assert.deepEqual(pinProblem(start, [p(800, 0), p(900, 100)], radius, slots), {
    reason: 'pinTooClose', pin: 1,
  });
  const five = [p(400, 0), p(800, 0), p(1200, 0), p(0, 400), p(0, 800)];
  assert.deepEqual(pinProblem(start, five, radius, slots), { reason: 'tooManyPins', pin: 4 });
});
