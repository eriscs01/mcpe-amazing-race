// The lighting retry queue (spec §6.6): a change waits until the stop's chunk can be written.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RetryQueue } from '../src/core/arena/lighting.js';

const item = (id: number, lit: boolean) => ({ id, lit });
/** An apply that records the attempt number and answers `done`. */
const note = (seen: number[], done: boolean) => (_: unknown, tries: number): boolean => {
  seen.push(tries);
  return done;
};

test('an item that applies is removed; one that does not stays for the next drain', () => {
  const q = new RetryQueue<{ id: number; lit: boolean }>();
  q.set(item(1, true));
  q.set(item(2, true));
  q.drain((i) => i.id === 1, () => assert.fail('no errors expected'));
  assert.deepEqual(q.pending().map((i) => i.id), [2]);
  q.drain(() => true, () => assert.fail('no errors expected'));
  assert.equal(q.size, 0);
});

test('the latest wish for a stop replaces an earlier one that has not applied', () => {
  const q = new RetryQueue<{ id: number; lit: boolean }>();
  q.set(item(1, true));
  q.set(item(1, false));
  assert.deepEqual(q.pending(), [item(1, false)]);
});

test('attempts are counted per item and reset by a new wish', () => {
  const q = new RetryQueue<{ id: number; lit: boolean }>();
  const seen: number[] = [];
  q.set(item(1, true));
  q.drain(note(seen, false), () => {});
  q.drain(note(seen, false), () => {});
  q.set(item(1, false));
  q.drain(note(seen, true), () => {});
  assert.deepEqual(seen, [1, 2, 1]);
});

test('an item whose apply throws is dropped and reported; the rest still run', () => {
  const q = new RetryQueue<{ id: number; lit: boolean }>();
  const errors: number[] = [];
  const applied: number[] = [];
  q.set(item(1, true));
  q.set(item(2, true));
  q.drain((i) => {
    if (i.id === 1) throw new Error('boom');
    applied.push(i.id);
    return true;
  }, (i) => errors.push(i.id));
  assert.deepEqual(errors, [1]);
  assert.deepEqual(applied, [2]);
  assert.equal(q.size, 0);
});

test('an item set while the queue drains waits for the next round', () => {
  const q = new RetryQueue<{ id: number; lit: boolean }>();
  q.set(item(1, true));
  q.drain(() => {
    q.set(item(2, true));
    return true;
  }, () => {});
  assert.deepEqual(q.pending().map((i) => i.id), [2]);
});
