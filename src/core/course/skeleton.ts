// Course skeleton (spec §5, §6.4, §7.3): the ordered stop types of every leg, blind segments,
// each Detour's pair and Roadblock's kind, and which stops host-pinned waypoints become. Where
// each stop lies is the walk's job (walk.ts).
import { COURSE, DETOUR_PAIRS, ROADBLOCK_KINDS } from '../config.js';
import { Rng } from '../rng.js';
import { horizontalDistance } from '../vec.js';

import type { RoadblockKind } from '../config.js';
import type { StopType, TaskSpec } from '../types.js';
import type { Vec3 } from '../vec.js';

export interface Slot {
  leg: number;
  type: StopType;
  /** The segment into this stop shows coordinates only (spec §5). */
  blind: boolean;
  task?: TaskSpec;
  /** A host-pinned waypoint this stop must be placed on. */
  pin?: Vec3;
}

const LEG: readonly StopType[] = ['route', 'detour', 'roadblock', 'pit'];
const FINAL_LEG: readonly StopType[] = ['route', 'roadblock', 'detour', 'finish'];

const hasHunt = (p: (typeof DETOUR_PAIRS)[number]): boolean => p.a.kind === 'hunt'
  || p.b.kind === 'hunt';

/** A random item other than `last` (spec §7.3: never the same pair or kind twice in a row). */
const pickOther = <T>(rng: Rng, items: readonly T[], last: T | undefined): T => rng.pick(
  items.filter((item) => item !== last),
);

/** Stop types per leg with their challenges; the start line is stop 0, on leg 0. */
export function skeleton(
  { legs, peaceful, seed }: { legs: number; peaceful: boolean; seed: number },
): Slot[] {
  const rng = new Rng(seed);
  // Peaceful has no hostile mobs, so hunt goes everywhere (spec §7.3).
  const pairs = DETOUR_PAIRS.filter((p) => !peaceful || !hasHunt(p));
  const kinds = ROADBLOCK_KINDS.filter((k) => !peaceful || k !== 'hunt');
  let lastPair: (typeof pairs)[number] | undefined;
  let lastKind: RoadblockKind | undefined;
  const slots: Slot[] = [{ leg: 0, type: 'start', blind: false }];
  for (let leg = 1; leg <= legs; leg += 1) {
    const final = leg === legs;
    for (const type of final ? FINAL_LEG : LEG) {
      const slot: Slot = { leg, type, blind: type === 'detour' && leg >= 2 };
      if (type === 'detour') {
        const pair = pickOther(rng, pairs, lastPair);
        lastPair = pair;
        slot.task = { type: 'detour', options: [{ ...pair.a }, { ...pair.b }] };
      } else if (type === 'roadblock') {
        const kind = final ? 'recall' : pickOther<RoadblockKind>(rng, kinds, lastKind);
        lastKind = kind;
        slot.task = { type: 'roadblock', kind };
      }
      slots.push(slot);
    }
  }
  return slots;
}

/** Pins in visiting order: each next one is the nearest to the last (spec §6.4). */
export function nearestNeighbourOrder(start: Vec3, pins: readonly Vec3[]): Vec3[] {
  const left = [...pins];
  const order: Vec3[] = [];
  let at = start;
  while (left.length > 0) {
    let best = 0;
    for (const [i, pin] of left.entries()) {
      const bestPin = left[best] ?? pin;
      if (horizontalDistance(at, pin) < horizontalDistance(at, bestPin)) best = i;
    }
    const [next] = left.splice(best, 1);
    if (!next) break; // best is always in range
    order.push(next);
    at = next;
  }
  return order;
}

const pinnable = (slot: Slot): boolean => slot.type === 'detour' || slot.type === 'roadblock';

/**
 * Puts the pins, in visiting order, on Detour and Roadblock stops spread evenly over the course
 * (pin i of k takes the middle of the i-th k-th of those stops).
 */
export function assignPins(slots: readonly Slot[], start: Vec3, pins: readonly Vec3[]): Slot[] {
  const order = nearestNeighbourOrder(start, pins);
  const room = slots.flatMap((s, i) => (pinnable(s) ? [i] : []));
  const at = new Map(order.map((pin, i) => [
    room[Math.floor(((2 * i + 1) * room.length) / (2 * order.length))],
    pin,
  ]));
  return slots.map((s, i) => {
    const pin = at.get(i);
    return pin ? { ...s, pin } : s;
  });
}

export interface PinProblem {
  reason: 'pinOutsideCourse' | 'pinTooClose' | 'tooManyPins';
  /** Index into the host's pins: the first one that does not fit. */
  pin: number;
}

/** Why the pins cannot all be visited, or undefined if they can. */
export function pinProblem(
  start: Vec3,
  pins: readonly Vec3[],
  radius: number,
  slots: readonly Slot[],
): PinProblem | undefined {
  for (const [i, pin] of pins.entries()) {
    if (horizontalDistance(start, pin) > radius) return { reason: 'pinOutsideCourse', pin: i };
    const near = [start, ...pins.slice(0, i)];
    if (near.some((o) => horizontalDistance(o, pin) < COURSE.spacing)) {
      return { reason: 'pinTooClose', pin: i };
    }
  }
  const room = slots.filter(pinnable).length;
  return pins.length > room ? { reason: 'tooManyPins', pin: room } : undefined;
}
