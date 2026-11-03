// Course walk (spec §5, §6.2, §6.4): places the skeleton's stops one by one. Each free stop
// draws positions that keep the distance rules and leave the rest of the course placeable (a
// bounded backtracking search over geometry only), has them probed for terrain, and takes the
// first with a landmark or the flattest of the first 3 valid. Probing needs the world, so the
// walk is a generator: it yields a position, the caller probes it and sends back the result.
// planCourse drives it synchronously (tests); course generation drives it across game ticks.
import { Layout, PAUSE } from './layout.js';
import { placeName } from './names.js';
import { assignPins, pinProblem, skeleton } from './skeleton.js';
import { COURSE, TERRAIN_FALLBACK } from '../config.js';
import { Rng } from '../rng.js';

import type { Pause } from './layout.js';
import type { PinProblem, Slot } from './skeleton.js';
import type { Terrain } from '../config.js';
import type { Landmark, Stop, StopType } from '../types.js';
import type { Vec3 } from '../vec.js';

/** A probed candidate; `pos` may differ from the one asked (arena moved next to a landmark). */
export interface Probe {
  pos: Vec3;
  terrain: Terrain;
  /** Ground height spread across the 5 samples; smaller is flatter. */
  spread: number;
  landmark?: Landmark;
}

export type Prober = (pos: Vec3) => Probe | undefined;

export interface CourseInput {
  /** The host's position: the start line. */
  start: Vec3;
  pins: readonly Vec3[];
  legs: number;
  radius: number;
  peaceful: boolean;
  seed: number;
  /** Called after each stop is placed, with the stops placed and the stops planned so far. */
  onStop?: (placed: number, total: number) => void;
}

export type CourseOutcome = {
  ok: true;
  stops: Stop[];
  /** Candidates probed for each stop, by stop id. */
  probes: number[];
  /** Route Info stops added before pins or the Finish that one segment could not reach. */
  inserted: number;
} | {
  ok: false;
  /** noGround: every candidate probed was rejected; noRoom: no position kept the rules. */
  reason: 'noGround' | 'noRoom';
  stop: number;
  leg: number;
  type: StopType;
} | ({ ok: false } & PinProblem);

type Choice = { probe: Probe; asked: number } | 'noGround' | 'noRoom';

/**
 * Probes up to 6 candidates from `next`: the first valid one with a landmark wins, else the
 * flattest of the first 3 valid (the earliest on a tie). A candidate the probe moved (next to a
 * landmark) is checked again with `ok`.
 */
function* choose(
  next: () => Generator<Pause, Vec3 | undefined, unknown>,
  ok: (pos: Vec3) => Generator<Pause, boolean, unknown>,
): Generator<Vec3 | Pause, Choice, Probe | undefined> {
  const valid: Probe[] = [];
  let asked = 0;
  while (asked < COURSE.candidatesPerStop && valid.length < COURSE.validToChoose) {
    const candidate = yield* next();
    if (!candidate) break;
    asked += 1;
    const probe: Probe | undefined = yield candidate;
    const moved = probe && (probe.pos.x !== candidate.x || probe.pos.z !== candidate.z);
    if (probe && (!moved || (yield* ok(probe.pos)))) {
      if (probe.landmark) return { probe, asked };
      valid.push(probe);
    }
  }
  const flattest = valid.reduce<Probe | undefined>((best, p) => (
    best && best.spread <= p.spread ? best : p), undefined);
  if (flattest) return { probe: flattest, asked };
  return asked > 0 ? 'noGround' : 'noRoom';
}

/** The placed stops, with their names drawn as they are added. */
class Placed {
  readonly stops: Stop[] = [];

  readonly probes: number[] = [];

  private readonly used = new Set<string>();

  constructor(
    private readonly rng: Rng,
    private readonly planned: number,
    private readonly onStop?: CourseInput['onStop'],
  ) {}

  get lastPos(): Vec3 | undefined {
    return this.stops.at(-1)?.pos;
  }

  add(slot: Slot, probe: Probe, asked: number): void {
    const name = placeName(probe.terrain, this.used, this.rng);
    this.used.add(name);
    this.probes.push(asked);
    const stop: Stop = {
      id: this.stops.length,
      leg: slot.leg,
      type: slot.type,
      pos: probe.pos,
      terrain: probe.terrain,
      name,
      blind: slot.blind,
      built: false,
      lit: false,
    };
    if (probe.landmark) stop.landmark = probe.landmark;
    if (slot.task) stop.task = slot.task;
    if (slot.pin) stop.pinned = true;
    this.stops.push(stop);
    this.onStop?.(this.stops.length, Math.max(this.planned, this.stops.length));
  }
}

/**
 * Places a stop whose position is fixed (the start line, a pin). The probe supplies height,
 * terrain and any landmark, never a new position; if it rejects the ground, the stop is kept
 * with the fallback terrain.
 */
function* fixedStop(
  course: Placed,
  layout: Layout,
  slot: Slot,
  pos: Vec3,
  next: number,
): Generator<Vec3 | Pause, void, Probe | undefined> {
  const probe = yield pos;
  const placed: Probe = probe
    ? { ...probe, pos: { x: pos.x, y: probe.pos.y, z: pos.z } }
    : { pos, terrain: TERRAIN_FALLBACK, spread: 0 };
  course.add(slot, placed, 1);
  yield* layout.place(placed.pos, next);
}

/**
 * Yields each candidate position to probe (send back the Probe, or undefined if rejected) and,
 * between long searches, PAUSE (wait a tick, then call next() again). Returns the course.
 */
export function* generateCourse(
  input: CourseInput,
): Generator<Vec3 | Pause, CourseOutcome, Probe | undefined> {
  const rng = new Rng(input.seed);
  const { legs, peaceful } = input;
  const base = skeleton({ legs, peaceful, seed: rng.int(0, 0xffffffff) });
  const problem = pinProblem(input.start, input.pins, input.radius, base);
  if (problem) return { ok: false, ...problem };
  const slots = assignPins(base, input.start, input.pins);
  const layout = new Layout(input, slots, rng);
  const course = new Placed(rng, slots.length, input.onStop);
  const [first] = slots;
  if (!first) throw new Error('a skeleton always has a start line');
  yield* fixedStop(course, layout, first, input.start, 1);
  let inserted = 0;

  for (let j = 1; j < slots.length; j += 1) {
    const slot = slots[j];
    if (!slot) break;
    for (;;) {
      const from = course.lastPos ?? input.start;
      const route = layout.needsRoute(from, j);
      if (slot.pin && !route) {
        yield* fixedStop(course, layout, slot, slot.pin, j + 1);
        break;
      }
      const placing: Slot = route ? { leg: slot.leg, type: 'route', blind: false } : slot;
      const choice = yield* choose(
        () => layout.propose(from, j, route),
        (pos) => layout.viable(pos, from, j, route),
      );
      if (typeof choice === 'string') {
        const { leg, type } = placing;
        return {
          ok: false, reason: choice, stop: course.stops.length, leg, type,
        };
      }
      course.add(placing, choice.probe, choice.asked);
      yield* layout.place(choice.probe.pos, route ? j : j + 1);
      if (!route) break;
      inserted += 1;
    }
  }
  return {
    ok: true, stops: course.stops, probes: course.probes, inserted,
  };
}

export { PAUSE } from './layout.js';
export type { Pause } from './layout.js';

/** Runs the walk with a synchronous probe, without waiting at pauses. */
export function planCourse(input: CourseInput, probe: Prober): CourseOutcome {
  const steps = generateCourse(input);
  let step = steps.next();
  while (!step.done) step = steps.next(step.value === PAUSE ? undefined : probe(step.value));
  return step.value;
}
