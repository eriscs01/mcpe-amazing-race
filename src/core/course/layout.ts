// Course geometry (spec §5, §6.4): the distance rules, candidate draws, and a bounded
// depth-first search that checks the rest of the course can still be placed after a candidate.
// Geometry only: terrain is the walk's business (walk.ts).
import { COURSE } from '../config.js';
import { horizontalDistance as dist, offsetByYaw, yawTowards } from '../vec.js';

import type { Slot } from './skeleton.js';
import type { Rng } from '../rng.js';
import type { Vec3 } from '../vec.js';

export interface LayoutInput {
  /** The start line. */
  start: Vec3;
  radius: number;
  pins: readonly Vec3[];
}

/** Past 0.6 R, the cone of headings that turns the walk back toward the start line. */
export function homeHeadings(
  from: Vec3,
  start: Vec3,
  radius: number,
): { centre: number; spread: number } | undefined {
  if (dist(from, start) <= COURSE.driftBias * radius) return undefined;
  return { centre: yawTowards(from, start), spread: COURSE.driftCone };
}

const block = (pos: Vec3, y: number): Vec3 => ({ x: Math.round(pos.x), y, z: Math.round(pos.z) });

/** Least distance from the start line for every stop but the Finish, keeping its circle free. */
const FINISH_CLEARANCE = COURSE.finishFromStart + COURSE.spacing;

/** Where the walk must arrive next: a pin exactly, or the Finish's circle round the start line. */
interface Target {
  pos: Vec3;
  /** Furthest a stop may be from `pos` with one segment to go. */
  oneSegment: number;
  /** Index of the slot that arrives. */
  at: number;
  /** Too far to reach from the previous pin or start line without extra Route Info stops. */
  forced: boolean;
}

const key = (pos: Vec3): string => `${pos.x},${pos.z}`;

/** Course geometry: the distance rules, candidate draws and the search that looks ahead. */
export class Layout {
  /** Positions of the stops placed so far. */
  private readonly placed: Vec3[] = [];

  /** Positions known to complete the course from the last placed stop. */
  private way: Vec3[] = [];

  /** The ways found from this stop's candidates, by position. */
  private readonly ways = new Map<string, Vec3[]>();

  /** For each slot, the next pin or Finish it heads for. */
  private readonly targets: Target[];

  constructor(
    private readonly input: LayoutInput,
    private readonly slots: readonly Slot[],
    private readonly rng: Rng,
  ) {
    const isFixed = (s: Slot): boolean => s.pin !== undefined || s.type === 'finish';
    // Each slot heads for the first pin or Finish at or after it; the Finish is always last.
    const targets: Target[] = [];
    let next = this.targetAt(slots.length - 1);
    for (let j = slots.length - 1; j >= 0; j -= 1) {
      const slot = slots[j];
      if (slot && isFixed(slot)) next = this.targetAt(j, slot);
      targets[j] = next;
    }
    // A pin or Finish too far for the stops before it (from the start line or the previous pin)
    // is "forced": only then may the walk add Route Info stops or merely close in (spec §6.4).
    let from = { pos: input.start, at: 0 };
    for (const [j, slot] of slots.entries()) {
      const target = targets[j];
      if (target && isFixed(slot)) {
        const reach = target.oneSegment + (j - from.at - 1) * COURSE.segment.max;
        target.forced = dist(from.pos, target.pos) > reach;
        from = { pos: target.pos, at: j };
      }
    }
    this.targets = targets;
  }

  private targetAt(at: number, slot?: Slot): Target {
    if (slot?.pin) {
      return {
        pos: slot.pin, oneSegment: COURSE.segment.max, at, forced: false,
      };
    }
    return {
      pos: this.input.start,
      oneSegment: COURSE.segment.max + COURSE.finishFromStart - COURSE.reachMargin,
      at,
      forced: false,
    };
  }

  target(j: number): Target {
    const target = this.targets[j] ?? this.targets.at(-1);
    if (!target) throw new Error('a course always has a Finish');
    return target;
  }

  /** Slot `j` is a forced pin or Finish that one segment from `from` cannot reach (spec §6.4). */
  needsRoute(from: Vec3, j: number): boolean {
    const slot = this.slots[j];
    if (!slot || (slot.pin === undefined && slot.type !== 'finish')) return false;
    const target = this.target(j);
    return target.forced && dist(from, target.pos) > target.oneSegment;
  }

  /** The spec §5 rules for a stop after `prev`; pins count as stops from the outset. */
  keepsRules(pos: Vec3, prev: Vec3, finish: boolean, extra: readonly Vec3[]): boolean {
    const { start, radius, pins } = this.input;
    const seg = dist(prev, pos);
    if (seg < COURSE.segment.min || seg > COURSE.segment.max) return false;
    if (dist(pos, start) > radius) return false;
    const fromStart = dist(pos, start);
    if (finish ? fromStart > COURSE.finishFromStart : fromStart < FINISH_CLEARANCE) return false;
    return [this.placed, pins, extra].every((list) => list.every((o) => (
      dist(o, pos) >= COURSE.spacing)));
  }

  /**
   * Whether `pos` may take slot `j` after `from`: the rules, plus heading for the next pin or
   * the Finish (in reach of it, or, when that one is forced, at least closer). An extra Route
   * Info stop must get closer.
   */
  fits(pos: Vec3, from: Vec3, j: number, route: boolean, extra: readonly Vec3[]): boolean {
    const finish = !route && this.slots[j]?.type === 'finish';
    if (!this.keepsRules(pos, from, finish, extra)) return false;
    if (finish) return true;
    const target = this.target(j);
    const closer = dist(pos, target.pos) < dist(from, target.pos);
    if (route) return closer;
    const segments = target.at - j;
    const furthest = target.oneSegment + (segments - 1) * COURSE.segment.max;
    return dist(pos, target.pos) <= furthest || (target.forced && closer);
  }

  /** A candidate for slot `j` after `from`. */
  draw(from: Vec3, j: number, route: boolean): Vec3 {
    const { start, radius } = this.input;
    const { rng } = this;
    const along = (heading: number): Vec3 => block(
      offsetByYaw(from, heading, rng.range(COURSE.segment.min, COURSE.segment.max)),
      from.y,
    );
    if (route) {
      const cone = COURSE.insertCone;
      return along(yawTowards(from, this.target(j).pos) + rng.range(-cone, cone));
    }
    if (this.slots[j]?.type === 'finish') {
      const r = rng.range(COURSE.spacing, COURSE.finishFromStart);
      return block(offsetByYaw(start, rng.range(-180, 180), r), from.y);
    }
    const home = homeHeadings(from, start, radius);
    return along(home ? home.centre + rng.range(-home.spread, home.spread) : rng.range(-180, 180));
  }

  /**
   * The positions that place slots from `j` on after `from` (with `extra` stops assumed placed),
   * found by a depth-first search over the same draws and bounded by `budget` positions, or
   * undefined if none was found.
   */
  completion(
    from: Vec3,
    j: number,
    extra: readonly Vec3[],
    budget: { left: number },
  ): Vec3[] | undefined {
    const slot = this.slots[j];
    if (!slot) return [];
    if (budget.left <= 0) return undefined;
    budget.left -= 1; // eslint-disable-line no-param-reassign -- one budget shared by the search
    const route = this.needsRoute(from, j);
    if (slot.pin && !route) {
      const rest = this.completion(slot.pin, j + 1, extra, budget);
      return rest && [slot.pin, ...rest];
    }
    for (let i = 0; i < COURSE.searchTries; i += 1) {
      const pos = this.draw(from, j, route);
      const rest = this.fits(pos, from, j, route, extra)
        ? this.completion(pos, route ? j : j + 1, [...extra, pos], budget)
        : undefined;
      if (rest) return [pos, ...rest];
    }
    return undefined;
  }

  /** Repeated searches from a fixed stop, whose next stop may only have a small area to land. */
  private search(from: Vec3, next: number): Vec3[] | undefined {
    for (let i = 0; i < COURSE.searchRestarts; i += 1) {
      const way = this.completion(from, next, [], { left: COURSE.searchBudget });
      if (way) return way;
    }
    return undefined;
  }

  /** Whether `pos` fits slot `j` and leaves the rest placeable; remembers the way it found. */
  viable(pos: Vec3, from: Vec3, j: number, route: boolean): boolean {
    if (!this.fits(pos, from, j, route, [])) return false;
    const rest = this.completion(pos, route ? j : j + 1, [pos], { left: COURSE.searchBudget });
    if (rest) this.ways.set(key(pos), rest);
    return rest !== undefined;
  }

  /**
   * A random candidate that is viable; failing that, once per stop, the next position on the
   * way found when the last stop was placed, which is known to complete the course.
   */
  propose(from: Vec3, j: number, route: boolean): Vec3 | undefined {
    for (let i = 0; i < COURSE.proposalTries; i += 1) {
      const pos = this.draw(from, j, route);
      if (this.viable(pos, from, j, route)) return pos;
    }
    const [next, ...rest] = this.way;
    if (!next || this.ways.has(key(next))) return undefined;
    this.ways.set(key(next), rest);
    return next;
  }

  /**
   * Records a placed stop, `next` being the slot still to place, and follows the way found from
   * it; a stop placed off any known way (the start line, a pin, a moved candidate) searches anew.
   */
  place(pos: Vec3, next: number): void {
    const [ahead, ...rest] = this.way;
    const onWay = ahead && key(ahead) === key(pos) ? rest : undefined;
    const known = this.ways.get(key(pos)) ?? onWay;
    this.ways.clear();
    this.placed.push(pos);
    this.way = known ?? this.search(pos, next) ?? [];
  }
}
