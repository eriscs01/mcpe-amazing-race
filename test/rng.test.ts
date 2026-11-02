import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/core/rng.js';

const draw = (rng: Rng, n: number): number[] => Array.from({ length: n }, () => rng.next());

// Saved worlds and bug-report seeds depend on this exact sequence: changing the algorithm breaks them.
test('seed 42 yields the reference mulberry32 sequence', () => {
  const rng = new Rng(42);
  assert.deepEqual(draw(rng, 3), [0.6011037519201636, 0.44829055899754167, 0.8524657934904099]);
  assert.equal(rng.state, 1199730185);
  draw(rng, 97);
  assert.equal(rng.state, 2767954910);
});

test('the same seed reproduces the same sequence', () => {
  assert.deepEqual(draw(new Rng(42), 20), draw(new Rng(42), 20));
});

test('different seeds give different sequences', () => {
  assert.notDeepEqual(draw(new Rng(1), 5), draw(new Rng(2), 5));
});

test('a sequence resumes from its saved state', () => {
  const rng = new Rng(7);
  draw(rng, 13);
  const resumed = new Rng(rng.state);
  assert.deepEqual(draw(resumed, 10), draw(rng, 10));
});

test('next() stays within [0, 1)', () => {
  for (const x of draw(new Rng(123), 10_000)) assert.ok(x >= 0 && x < 1, `out of range: ${x}`);
});

test('int() is inclusive at both ends and reaches every value', () => {
  const rng = new Rng(9);
  const seen = new Set<number>();
  for (let i = 0; i < 2_000; i++) {
    const v = rng.int(600, 605);
    assert.ok(Number.isInteger(v) && v >= 600 && v <= 605, `out of range: ${v}`);
    seen.add(v);
  }
  assert.equal(seen.size, 6);
});

test('int() rejects an empty or non-integer range', () => {
  const rng = new Rng(1);
  assert.throws(() => rng.int(5, 4), RangeError);
  assert.throws(() => rng.int(0.5, 3), RangeError);
});

test('range() stays within [min, max)', () => {
  const rng = new Rng(5);
  for (let i = 0; i < 1_000; i++) {
    const v = rng.range(-180, 180);
    assert.ok(v >= -180 && v < 180, `out of range: ${v}`);
  }
});

test('pick() returns an element and rejects an empty list', () => {
  const rng = new Rng(3);
  const items = ['a', 'b', 'c'] as const;
  for (let i = 0; i < 50; i++) assert.ok(items.includes(rng.pick(items)));
  assert.throws(() => rng.pick([]), RangeError);
});

test('shuffle() returns a permutation and leaves the input untouched', () => {
  const input = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8]);
  const out = new Rng(11).shuffle(input);
  assert.deepEqual(
    [...out].sort((a, b) => a - b),
    [...input],
  );
  assert.notStrictEqual(out, input);
});

test('shuffle() is reproducible from the seed', () => {
  const input = [...'abcdefghij'];
  assert.deepEqual(new Rng(77).shuffle(input), new Rng(77).shuffle(input));
});

test('shuffle() is not biased toward keeping the first element in place', () => {
  const rng = new Rng(2024);
  const counts = [0, 0, 0, 0];
  const trials = 8_000;
  for (let i = 0; i < trials; i++) counts[rng.shuffle([0, 1, 2, 3])[0]!]!++;
  for (const c of counts)
    assert.ok(Math.abs(c / trials - 0.25) < 0.03, `skewed: ${counts.join(',')}`);
});
