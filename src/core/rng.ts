// Seeded PRNG (mulberry32). The seed and current state are plain numbers, so a course or quiz
// draw can be saved, resumed and reproduced in a test from a host's bug report.
/* eslint-disable no-bitwise -- mulberry32 is defined by 32-bit integer operations */

export class Rng {
  private s: number;

  /** `seed` may also be a previously saved `state`, which resumes that sequence. */
  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** Current position in the sequence; persist it to resume later. */
  get state(): number {
    return this.s;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform integer in [min, max], both inclusive. */
  int(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new RangeError(`int(${min}, ${max}): need integers with min <= max`);
    }
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('pick() from an empty list');
    // The index is in range, so the element is a T even when T itself allows undefined.
    return items[Math.floor(this.next() * items.length)] as T;
  }

  /** A shuffled copy (Fisher–Yates); the input is not modified. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.next() * (i + 1));
      const swap = out[i] as T; // i and j are in range
      out[i] = out[j] as T;
      out[j] = swap;
    }
    return out;
  }
}
