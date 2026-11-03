import assert from 'node:assert/strict';
import { test } from 'node:test';

import { canEnter } from '../src/core/phase.js';

import type { Phase } from '../src/core/types.js';

const allowed: [Phase, Phase][] = [
  ['setup', 'generating'],
  ['generating', 'ready'],
  ['generating', 'setup'],
  ['ready', 'generating'],
  ['ready', 'running'],
  ['running', 'paused'],
  ['paused', 'running'],
  ['running', 'dayEnded'],
  ['paused', 'dayEnded'],
  ['dayEnded', 'running'],
  ['running', 'finished'],
  ['paused', 'finished'],
  ['dayEnded', 'finished'],
];

const phases: Phase[] = [
  'setup', 'generating', 'ready', 'running', 'paused', 'dayEnded', 'finished',
];

test('exactly the race lifecycle transitions are allowed', () => {
  const key = ([a, b]: [Phase, Phase]) => `${a}→${b}`;
  const got = phases.flatMap((from) => phases.map((to): [Phase, Phase] => [from, to]))
    .filter(([from, to]) => canEnter(from, to))
    .map(key)
    .sort();
  assert.deepEqual(got, allowed.map(key).sort());
});

test('a finished race goes nowhere', () => {
  assert.ok(phases.every((to) => !canEnter('finished', to)));
});
