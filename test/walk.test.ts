// Course walk (spec §5, §6.2, §6.4): where each stop goes, checked against the distance rules,
// with candidate choice driven by terrain probes. Probes here are scripted; the game's terrain
// probe drives the same generator in G6.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { COURSE, TERRAIN_FALLBACK, TERRAIN_NAMES } from '../src/core/config.js';
import { homeHeadings } from '../src/core/course/layout.js';
import { generateCourse, PAUSE, planCourse } from '../src/core/course/walk.js';
import { Rng } from '../src/core/rng.js';
import { horizontalDistance as dist, yawTowards } from '../src/core/vec.js';

import type {
  CourseInput, CourseOutcome, Probe, Prober,
} from '../src/core/course/walk.js';
import type { Stop } from '../src/core/types.js';
import type { Vec3 } from '../src/core/vec.js';

const start = { x: 100, y: 64, z: -50 };
const flat = (pos: Vec3): Probe => ({ pos: { ...pos, y: 70 }, terrain: 'plains', spread: 0 });

const input = (over: Partial<CourseInput> = {}): CourseInput => ({
  start, pins: [], legs: 6, radius: 1800, peaceful: false, seed: 1, ...over,
});

const pin = (x: number, z: number): Vec3 => ({ x: start.x + x, y: 75, z: start.z + z });

function stopsOf(out: CourseOutcome): Stop[] {
  assert.ok(out.ok, JSON.stringify(out));
  return out.stops;
}

/** Every rule of spec §5 that holds for every course; pinned segments are checked apart. */
function assertRules(stops: readonly Stop[], radius: number, pins: readonly Vec3[] = []): void {
  const pinned = (s: Stop): boolean => pins.some((q) => q.x === s.pos.x && q.z === s.pos.z);
  assert.equal(stops[0]?.type, 'start');
  for (const [i, s] of stops.entries()) {
    assert.equal(s.id, i);
    assert.ok(dist(s.pos, start) <= radius, `stop ${i} outside the radius`);
    if (i > 0 && s.type !== 'finish' && !pinned(s)) {
      const clear = COURSE.finishFromStart + COURSE.spacing;
      assert.ok(dist(s.pos, start) >= clear, `stop ${i} crowds the Finish's circle`);
    }
    for (const other of stops.slice(0, i)) {
      assert.ok(dist(s.pos, other.pos) >= COURSE.spacing, `stop ${i} near stop ${other.id}`);
    }
    const prev = stops[i - 1];
    if (prev) {
      const d = dist(prev.pos, s.pos);
      assert.ok(d <= COURSE.segment.max, `segment into ${i} is ${d}`);
      if (!pinned(s)) assert.ok(d >= COURSE.segment.min, `segment into ${i} is ${d}`);
    }
    assert.equal(s.built, false);
    assert.equal(s.lit, false);
  }
  const finish = stops.at(-1);
  assert.equal(finish?.type, 'finish');
  assert.ok(finish && dist(finish.pos, start) <= COURSE.finishFromStart);
  const names = stops.map((s) => s.name);
  assert.equal(new Set(names).size, names.length, 'names repeat');
}

test('courses of every length keep the distance rules on flat ground', () => {
  for (let legs = 2; legs <= 12; legs += 1) {
    for (let seed = 1; seed <= 12; seed += 1) {
      const radius = Math.min(2400, Math.max(1400, 1200 + 100 * legs));
      const stops = stopsOf(planCourse(input({ legs, radius, seed }), flat));
      assert.equal(stops.length, 4 * legs + 1);
      assertRules(stops, radius);
    }
  }
});

test('the start stop is the host\'s position; stops take the probed height and terrain', () => {
  const stops = stopsOf(planCourse(input(), (pos) => ({
    pos: { ...pos, y: 80 }, terrain: pos === start ? 'snowy' : 'desert', spread: 0,
  })));
  assert.deepEqual(stops[0]?.pos, { ...start, y: 80 });
  assert.equal(stops[0]?.terrain, 'snowy');
  const prefix = stops[0]?.name.split(' ')[0] ?? '';
  assert.ok(TERRAIN_NAMES.snowy.prefixes.includes(prefix), stops[0]?.name);
  assert.ok(stops.slice(1).every((s) => s.terrain === 'desert' && s.pos.y === 80));
});

test('a start line the probe rejects is kept, with the fallback terrain', () => {
  const stops = stopsOf(planCourse(input(), (pos) => (pos === start ? undefined : flat(pos))));
  assert.deepEqual(stops[0]?.pos, start);
  assert.equal(stops[0]?.terrain, TERRAIN_FALLBACK);
});

test('stops copy the skeleton\'s leg, type, blind flag and challenge', () => {
  const stops = stopsOf(planCourse(input({ legs: 3 }), flat));
  const detour = stops[6];
  assert.deepEqual([detour?.leg, detour?.type, detour?.blind, detour?.task?.type], [
    2, 'detour', true, 'detour',
  ]);
  assert.equal(stops[11]?.task?.type, 'detour');
  assert.deepEqual(stops[10]?.task, { type: 'roadblock', kind: 'recall' });
});

test('the same seed and terrain give the same course', () => {
  const a = planCourse(input({ seed: 5 }), flat);
  assert.deepEqual(planCourse(input({ seed: 5 }), flat), a);
  assert.notDeepEqual(planCourse(input({ seed: 6 }), flat), a);
});

test('past 0.6 R the next heading points back toward the start, within the cone', () => {
  const far = { x: start.x + 1200, y: 64, z: start.z };
  const home = yawTowards(far, start);
  assert.deepEqual(homeHeadings(far, start, 1800), { centre: home, spread: COURSE.driftCone });
  const near = { x: start.x + 1000, y: 64, z: start.z };
  assert.equal(homeHeadings(near, start, 1800), undefined);
});

/** Feeds probes from a list in order, then flat ground. */
function scripted(answers: Prober[]): Prober {
  let call = 0;
  return (pos) => {
    call += 1;
    if (call === 1) return flat(pos); // the start line
    const answer = answers.shift();
    return answer ? answer(pos) : flat(pos);
  };
}

const withSpread = (spread: number) => (pos: Vec3): Probe => ({ ...flat(pos), spread });
const rejected = (): undefined => undefined;

test('a stop takes the first candidate with a landmark', () => {
  const asked: Vec3[] = [];
  const landmark = (pos: Vec3): Probe => {
    asked.push(pos);
    return { ...flat(pos), spread: 5, landmark: { kind: 'village', pos } };
  };
  const stops = stopsOf(planCourse(input(), scripted([withSpread(0), rejected, landmark])));
  assert.equal(stops[1]?.landmark?.kind, 'village');
  assert.deepEqual(stops[1]?.pos, { ...asked[0], y: 70 });
});

test('without a landmark, a stop takes the flattest of the first 3 valid candidates', () => {
  const seen: Vec3[] = [];
  const spread = (n: number) => (pos: Vec3): Probe => {
    seen.push(pos);
    return { ...flat(pos), spread: n };
  };
  const out = planCourse(input(), scripted([spread(4), rejected, spread(1), spread(3)]));
  const stops = stopsOf(out);
  assert.deepEqual(stops[1]?.pos, { ...seen[1], y: 70 });
  assert.equal(out.ok && out.probes[1], 4); // 3 valid, plus the rejected one
});

test('a stop with 6 rejected candidates ends generation with a reason', () => {
  const out = planCourse(input(), scripted(Array.from({ length: 6 }, () => rejected)));
  assert.deepEqual(out, {
    ok: false, reason: 'noGround', stop: 1, leg: 1, type: 'route',
  });
});

test('a candidate moved by the probe (to a landmark) is rejected if it breaks the rules', () => {
  const moved = (): Probe => ({ ...flat(start), landmark: { kind: 'village', pos: start } });
  const stops = stopsOf(planCourse(input(), scripted([moved])));
  assert.equal(stops[1]?.landmark, undefined);
  assertRules(stops, 1800);
});

test('the generator yields each candidate and takes the probe\'s answer', () => {
  const gen = generateCourse(input({ legs: 2, radius: 1400 }));
  let step = gen.next();
  assert.deepEqual(step.value, start);
  let yields = 0;
  while (!step.done) {
    assert.notEqual(step.value, PAUSE, 'a short course needs no pause');
    yields += 1;
    step = gen.next(step.value === PAUSE ? undefined : flat(step.value));
  }
  assert.equal(yields, 1 + 8 * 3); // start, then 3 valid candidates per stop
  assert.equal(step.value.ok, true);
});

test('long searches pause between candidates, and pausing changes nothing', () => {
  const big = input({
    legs: 12, radius: 2400, pins: [pin(1500, 0), pin(-900, 1400), pin(200, -2000)], seed: 3,
  });
  const gen = generateCourse(big);
  let step = gen.next();
  let pauses = 0;
  while (!step.done) {
    if (step.value === PAUSE) pauses += 1;
    step = gen.next(step.value === PAUSE ? flat(start) : flat(step.value)); // a pause ignores it
  }
  assert.ok(pauses > 0, 'no pause');
  assert.deepEqual(step.value, planCourse(big, flat));
});

test('pinned waypoints become stops at their exact place', () => {
  const pins = [pin(900, 300), pin(-700, -800)];
  const stops = stopsOf(planCourse(input({ pins }), flat));
  const at = stops.filter((s) => s.pinned).map((s) => [s.type, s.pos.x, s.pos.z]);
  assert.deepEqual(at.map((a) => a.slice(1)), [
    [pins[0]?.x, pins[0]?.z], [pins[1]?.x, pins[1]?.z],
  ]);
  assert.ok(at.every(([type]) => type === 'detour' || type === 'roadblock'));
  assertRules(stops, 1800, pins);
});

test('a pin too far for one segment gets extra Route Info stops before it', () => {
  // Two legs give 4 pin slots; visiting order is A, D, C, B. A→D and C→B are back to back
  // (leg 1's Detour → Roadblock, leg 2's Roadblock → Detour) and over 900 blocks apart, and B is
  // too far from the start line for the Finish to follow in one segment.
  const pins = [pin(700, 0), pin(-700, 1200), pin(-1300, -200), pin(200, -1400)];
  const out = planCourse(input({ legs: 2, radius: 1800, pins }), flat);
  const stops = stopsOf(out);
  assert.ok(out.ok && out.inserted >= 3, `inserted ${out.ok && out.inserted}`);
  assert.equal(stops.length, 4 * 2 + 1 + (out.ok ? out.inserted : 0));
  assert.deepEqual(
    stops.filter((s) => s.pinned).map((s) => `${s.leg}:${s.type}`),
    ['1:detour', '1:roadblock', '2:roadblock', '2:detour'],
  );
  assertRules(stops, 1800, pins);
});

test('pinned courses keep the rules across seeds', () => {
  const pins = [pin(1200, 0), pin(-600, 900), pin(300, -1300)];
  for (let seed = 1; seed <= 25; seed += 1) {
    assertRules(stopsOf(planCourse(input({ pins, seed }), flat)), 1800, pins);
  }
});

test('a pin the probe rejects is kept where the host put it, with the fallback terrain', () => {
  const pins = [pin(900, 300)];
  const stops = stopsOf(planCourse(input({ pins }), (pos) => (
    pos.x === pins[0]?.x && pos.z === pins[0]?.z ? undefined : flat(pos))));
  const placed = stops.find((s) => s.pinned);
  assert.deepEqual(placed?.pos, pins[0]);
  assert.equal(placed?.terrain, TERRAIN_FALLBACK);
});

test('a bad pin ends generation before any stop is probed', () => {
  let probes = 0;
  const out = planCourse(input({ pins: [pin(5000, 0)] }), (pos) => {
    probes += 1;
    return flat(pos);
  });
  assert.deepEqual(out, { ok: false, reason: 'pinOutsideCourse', pin: 0 });
  assert.equal(probes, 0);
});

test('a probe never moves a pin or the start line; it gives their height and terrain', () => {
  const pins = [pin(900, 300)];
  const shifted = (pos: Vec3): Probe => ({
    pos: { x: pos.x + 25, y: 81, z: pos.z - 25 },
    terrain: 'swamp',
    spread: 1,
    landmark: { kind: 'village', pos },
  });
  const isFixed = (pos: Vec3): boolean => pos === start || pos === pins[0];
  const stops = stopsOf(planCourse(input({ pins }), (pos) => (
    isFixed(pos) ? shifted(pos) : flat(pos))));
  const fixed = [stops[0], stops.find((s) => s.pinned)];
  assert.deepEqual(fixed.map((s) => s?.pos), [{ ...start, y: 81 }, { ...pins[0], y: 81 }]);
  assert.ok(fixed.every((s) => s?.terrain === 'swamp' && s.landmark?.kind === 'village'));
  assertRules(stops, 1800, pins);
});

test('three pins near each other on a small course still place (search regression)', () => {
  const near = (x: number, z: number): Vec3 => ({ x, y: 64, z });
  const origin = { x: 0, y: 64, z: 0 };
  const pins = [near(-1018, 521), near(-10, 879), near(-452, 509)];
  for (let seed = 1; seed <= 15; seed += 1) {
    const out = planCourse({
      start: origin, pins, legs: 3, radius: 1500, peaceful: false, seed,
    }, flat);
    assert.ok(out.ok, `seed ${seed}: ${JSON.stringify(out)}`);
  }
});

test('rules hold when probes reject ground and move arenas to landmarks', () => {
  const pins = [pin(1100, 200), pin(-500, -900)];
  for (let seed = 1; seed <= 12; seed += 1) {
    const rng = new Rng(seed * 31);
    const rough: Prober = (pos) => {
      const roll = rng.next();
      if (roll < 0.3) return undefined;
      if (roll < 0.45) {
        const moved = { x: pos.x + rng.int(-40, 40), y: 70, z: pos.z + rng.int(-40, 40) };
        return { ...flat(moved), landmark: { kind: 'village', pos } };
      }
      return { ...flat(pos), spread: rng.int(0, 6) };
    };
    const out = planCourse(input({
      legs: 4, radius: 1600, pins, seed,
    }), rough);
    if (out.ok) assertRules(out.stops, 1600, pins);
    else assert.equal(!out.ok && 'reason' in out && out.reason, 'noGround');
  }
});
