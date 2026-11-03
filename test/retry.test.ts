// Forms are rejected with UserBusy while chat is open; the wrapper retries a bounded number of
// times (technical design §2.8) and reports when it gave up.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { retryWhileBusy } from '../src/core/retry.js';

function attempts(results: string[]) {
  let calls = 0;
  let waits = 0;
  return {
    attempt: async () => {
      const r = results[Math.min(calls, results.length - 1)] ?? 'busy';
      calls += 1;
      return r;
    },
    wait: async () => {
      waits += 1;
    },
    get calls() {
      return calls;
    },
    get waits() {
      return waits;
    },
  };
}

test('a form that is not busy is shown once', async () => {
  const a = attempts(['ok']);
  assert.equal(await retryWhileBusy(a.attempt, (r) => r === 'busy', a.wait, 10), 'ok');
  assert.equal(a.calls, 1);
  assert.equal(a.waits, 0);
});

test('a busy form is retried until the player is free', async () => {
  const a = attempts(['busy', 'busy', 'ok']);
  assert.equal(await retryWhileBusy(a.attempt, (r) => r === 'busy', a.wait, 10), 'ok');
  assert.equal(a.calls, 3);
  assert.equal(a.waits, 2);
});

test('after the last try it gives up with undefined', async () => {
  const a = attempts(['busy']);
  assert.equal(await retryWhileBusy(a.attempt, (r) => r === 'busy', a.wait, 4), undefined);
  assert.equal(a.calls, 4);
  assert.equal(a.waits, 3);
});
