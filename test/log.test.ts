import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LogCapture } from './helpers/logCapture.js';
import { guard, Logger } from '../src/core/log.js';

const setup = (clock = 120) => {
  const cap = new LogCapture();
  return { cap, log: new Logger(cap.sink, () => ({ clock })) };
};

test('lines are a fixed event name plus key=value fields, keyed by race clock', () => {
  const { cap, log } = setup();
  log.info('stepAdvanced', {
    team: 'red', leg: 3, step: 2, skipped: undefined,
  });
  log.warn('refused', { code: 'badPhase', player: 'p 1' });
  assert.deepEqual(cap.lines, [
    { level: 'info', line: '[race] stepAdvanced clock=120 team=red leg=3 step=2' },
    { level: 'warn', line: '[race] refused clock=120 code=badPhase player="p 1"' },
  ]);
});

test('errors carry the stack', () => {
  const { cap, log } = setup();
  log.error('handlerFailed', new Error('boom'), { handler: 'tick' });
  const [entry] = cap.lines;
  assert.equal(entry?.level, 'error');
  const [head, ...stack] = (entry?.line ?? '').split('\n');
  assert.equal(head, '[race] handlerFailed clock=120 handler=tick error=boom');
  assert.match(stack.join('\n'), /Error: boom/);
});

test('non-Error throws are still logged', () => {
  const { cap, log } = setup();
  log.error('handlerFailed', 'just a string');
  assert.equal(cap.lines[0]?.line, '[race] handlerFailed clock=120 error="just a string"');
});

test('guard logs a throwing handler and keeps going', () => {
  const { cap, log } = setup();
  const handler = guard(log, 'tick', () => {
    throw new Error('boom');
  });
  assert.doesNotThrow(() => handler());
  assert.equal(cap.find('handlerFailed').length, 1);
  assert.match(cap.lines[0]?.line ?? '', /handler=tick/);
});

test('guard logs a rejected async handler', async () => {
  const { cap, log } = setup();
  const handler = guard(log, 'form', async () => {
    await Promise.resolve();
    throw new Error('late');
  });
  handler();
  await new Promise((r) => {
    setImmediate(r);
  });
  assert.match(cap.find('handlerFailed')[0]?.line ?? '', /handler=form error=late/);
});

test('guard passes arguments through', () => {
  const { log } = setup();
  const seen: number[] = [];
  guard(log, 'x', (n: number) => {
    seen.push(n);
  })(5);
  assert.deepEqual(seen, [5]);
});
