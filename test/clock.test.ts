import assert from 'node:assert/strict';
import { test } from 'node:test';

import { advanceClock } from '../src/core/clock.js';
import { createState } from '../src/core/state.js';

import type { Phase } from '../src/core/types.js';

const inPhase = (phase: Phase) => ({ ...createState(1), phase, clock: 500 });

test('the race clock advances one tick per game tick while the race runs', () => {
  assert.equal(advanceClock(inPhase('running')).clock, 501);
});

for (const phase of ['setup', 'generating', 'ready', 'paused', 'dayEnded', 'finished'] as const) {
  test(`the race clock is frozen while ${phase}`, () => {
    const state = inPhase(phase);
    assert.equal(advanceClock(state), state);
  });
}
