import assert from 'node:assert/strict';
import { test } from 'node:test';

import { reduce } from '../src/core/race/engine.js';
import { createState } from '../src/core/state.js';

test('a tick advances the race clock while running', () => {
  const state = { ...createState(1), phase: 'running' as const };
  const out = reduce(state, { type: 'tick' });
  assert.equal(out.state.clock, 1);
  assert.deepEqual(out.effects, []);
  assert.equal(out.refusal, undefined);
});

test('an allowed phase change updates the phase', () => {
  const out = reduce(createState(1), { type: 'setPhase', to: 'generating' });
  assert.equal(out.state.phase, 'generating');
  assert.equal(out.refusal, undefined);
});

test('a refused phase change keeps state, returns a code and tells whoever asked', () => {
  const state = createState(1);
  const out = reduce(state, { type: 'setPhase', to: 'running', by: 'p1' });
  assert.equal(out.state, state);
  assert.equal(out.refusal, 'badPhase');
  assert.deepEqual(out.effects, [
    {
      kind: 'notify', to: 'p1', code: 'badPhase', text: 'Not possible while the race is in setup.',
    },
  ]);
});

test('a refused phase change with nobody asking only returns the code', () => {
  const out = reduce(createState(1), { type: 'setPhase', to: 'finished' });
  assert.equal(out.refusal, 'badPhase');
  assert.deepEqual(out.effects, []);
});
