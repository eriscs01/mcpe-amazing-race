// Generation job (spec §6.1): drives the course walk across game ticks. The world is a fake
// source here; the adapter's terrain probe is the real one.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runGeneration, TickingAreaFull } from '../src/core/course/job.js';
import { generateCourse, PAUSE, TIMEOUT } from '../src/core/course/walk.js';

import type { ProbeSource } from '../src/core/course/job.js';
import type { Answer, CourseInput, Probe } from '../src/core/course/walk.js';
import type { Vec3 } from '../src/core/vec.js';

const start = { x: 0, y: 64, z: 0 };
const input = (over: Partial<CourseInput> = {}): CourseInput => ({
  start, pins: [], legs: 4, radius: 1800, peaceful: false, seed: 7, ...over,
});
const flat = (pos: Vec3): Probe => ({ pos: { ...pos, y: 70 }, terrain: 'plains', spread: 0 });

class FakeSource implements ProbeSource {
  loads: Vec3[] = [];

  pauses = 0;

  constructor(private readonly answer: (pos: Vec3, n: number) => Answer = flat) {}

  async load(pos: Vec3): Promise<Answer> {
    this.loads.push(pos);
    return this.answer(pos, this.loads.length);
  }

  async pause(): Promise<void> {
    this.pauses += 1;
  }
}

/** How many times the walk yields PAUSE when probed by `answer` (the job must wait for each). */
function pausesOf(i: CourseInput): number {
  const steps = generateCourse(i);
  let pauses = 0;
  let step = steps.next();
  while (!step.done) {
    if (step.value === PAUSE) pauses += 1;
    step = steps.next(step.value === PAUSE ? undefined : flat(step.value));
  }
  return pauses;
}

test('a course probes every stop through the source and returns the walk outcome', async () => {
  const source = new FakeSource();
  const out = await runGeneration(input(), source);
  assert.ok(out.ok);
  assert.equal(out.stops.length > 4, true);
  assert.ok(source.loads.length >= out.stops.length);
  assert.deepEqual(out.stops[0]?.pos.x, 0);
});

test('the job waits for every pause the walk asks for', async () => {
  const hard = input({ legs: 6, pins: [{ x: -1018, y: 70, z: 521 }, { x: -10, y: 70, z: 879 }] });
  const source = new FakeSource();
  await runGeneration(hard, source);
  assert.equal(source.pauses, pausesOf(hard));
});

test('a rejected or timed-out candidate (undefined) moves on to the next one', async () => {
  const source = new FakeSource((pos, n) => (n % 2 === 0 ? undefined : flat(pos)));
  const out = await runGeneration(input(), source);
  assert.ok(out.ok);
});

test('when every candidate is rejected the course fails with noGround', async () => {
  const out = await runGeneration(input(), new FakeSource(() => undefined));
  assert.ok(!out.ok);
  assert.equal(!out.ok && 'reason' in out && out.reason, 'noGround');
});

test('when the area never loads the course fails with loadTimeout, not noGround (#33)', async () => {
  const out = await runGeneration(input(), new FakeSource(() => TIMEOUT));
  assert.equal(!out.ok && 'reason' in out && out.reason, 'loadTimeout');
});

test('half timeouts and half rough ground still count as a load problem; fewer do not', async () => {
  // Load 1 is the start line; then the candidates alternate between timeouts and rejections.
  const mixed = new FakeSource((pos, n) => (n === 1 ? flat(pos) : (n % 2 === 0 ? TIMEOUT : undefined)));
  const half = await runGeneration(input(), mixed);
  assert.equal(!half.ok && 'reason' in half && half.reason, 'loadTimeout');
  const few = new FakeSource((pos, n) => (n === 1 ? flat(pos) : (n === 3 ? TIMEOUT : undefined)));
  const rare = await runGeneration(input(), few);
  assert.equal(!rare.ok && 'reason' in rare && rare.reason, 'noGround');
});

test('a full ticking-area list stops the job at once', async () => {
  const source = new FakeSource((pos, n) => {
    if (n === 3) throw new TickingAreaFull();
    return flat(pos);
  });
  const out = await runGeneration(input(), source);
  assert.deepEqual(out, { ok: false, reason: 'tickingAreaFull' });
  assert.equal(source.loads.length, 3);
});

test('other errors from the source reach the caller (it logs them)', async () => {
  const source = new FakeSource(() => {
    throw new Error('boom');
  });
  await assert.rejects(runGeneration(input(), source), /boom/);
});

test('progress reports each stop placed against the stops planned', async () => {
  const seen: [number, number][] = [];
  const out = await runGeneration(
    input({ onStop: (placed, total) => seen.push([placed, total]) }),
    new FakeSource(),
  );
  assert.ok(out.ok);
  assert.equal(seen.length, out.stops.length);
  assert.deepEqual(seen.map(([placed]) => placed), out.stops.map((s) => s.id + 1));
  assert.ok(seen.every(([, total]) => total >= 2));
});

test('the same seed and terrain replay the same course', async () => {
  const a = await runGeneration(input(), new FakeSource());
  const b = await runGeneration(input(), new FakeSource());
  assert.deepEqual(a, b);
});
