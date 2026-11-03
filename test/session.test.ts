// The session connects the core reducer to persistence and the effect executor: these tests
// prove load, dispatch, save timing and failure handling across that boundary.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LogCapture } from './helpers/logCapture.js';
import { MapBag } from './helpers/mapBag.js';
import { ADDON_VERSION, SAVE_EVERY_TICKS } from '../src/core/config.js';
import {
  chunkKey,
  COUNT_KEY, loadState, saveState,
} from '../src/core/persist.js';
import { Session } from '../src/core/session.js';
import { createState } from '../src/core/state.js';

import type { Effect, State } from '../src/core/types.js';

function setup(saved?: State) {
  const bag = new MapBag();
  if (saved) saveState(bag, saved);
  bag.writes = 0;
  const cap = new LogCapture();
  const executed: Effect[] = [];
  const session = new Session({
    bag,
    sink: cap.sink,
    execute: (effects) => {
      executed.push(...effects);
    },
    newSeed: () => 4242,
  });
  return {
    bag, cap, executed, session,
  };
}

const saved = (bag: MapBag): State => {
  const out = loadState(bag);
  assert.equal(out.kind, 'loaded');
  return (out as { state: State }).state;
};

test('a fresh world starts a new race in setup and saves it at once', () => {
  const { bag, cap, session } = setup();
  session.load();
  assert.equal(session.state?.phase, 'setup');
  assert.equal(session.state?.seed, 4242);
  assert.deepEqual(saved(bag), session.state);
  const loaded = cap.find('loaded')[0]?.line ?? '';
  assert.match(loaded, new RegExp(`version=${ADDON_VERSION} schema=1 source=new`));
});

test('a saved race is resumed as saved and logged with its version', () => {
  const state = { ...createState(9), phase: 'ready' as const, clock: 77 };
  const { cap, session } = setup(state);
  session.load();
  assert.deepEqual(session.state, state);
  const loaded = cap.find('loaded')[0]?.line ?? '';
  assert.match(loaded, /clock=77 version=\S+ schema=1 source=saved phase=ready/);
});

test('a race that was running when the world closed comes back paused', () => {
  const { bag, cap, session } = setup({ ...createState(9), phase: 'running', clock: 300 });
  session.load();
  assert.equal(session.state?.phase, 'paused');
  assert.equal(saved(bag).phase, 'paused');
  assert.equal(cap.find('pausedOnLoad').length, 1);
});

test('an unreadable save is kept untouched and the add-on stays idle', () => {
  const { bag, cap, session } = setup();
  bag.set(COUNT_KEY, 2);
  bag.set(chunkKey(0), '{"v":1}');
  const before = new Map(bag.map);
  session.load();
  assert.equal(session.state, undefined);
  for (let n = 1; n <= SAVE_EVERY_TICKS * 2; n += 1) session.onTick(n);
  session.dispatch({ type: 'setPhase', to: 'generating' });
  assert.deepEqual(bag.map, before);
  const [line] = cap.find('loadFailed');
  assert.equal(line?.level, 'error');
  assert.match(line?.line ?? '', /reason=missingChunk/);
  assert.equal(cap.find('droppedNoState').length, 1, 'dropped actions are explained once');
});

test('a state change is saved immediately', () => {
  const { bag, session } = setup(createState(1));
  session.load();
  session.dispatch({ type: 'setPhase', to: 'generating' });
  assert.equal(saved(bag).phase, 'generating');
});

test('the clock alone is saved every 5 seconds, not every tick', () => {
  const { bag, session } = setup({ ...createState(1), phase: 'ready' });
  session.load();
  session.dispatch({ type: 'setPhase', to: 'running' });
  bag.writes = 0;
  for (let n = 1; n < SAVE_EVERY_TICKS; n += 1) session.onTick(n);
  assert.equal(bag.writes, 0);
  assert.equal(session.state?.clock, SAVE_EVERY_TICKS - 1);
  session.onTick(SAVE_EVERY_TICKS);
  assert.equal(saved(bag).clock, SAVE_EVERY_TICKS);
});

test('nothing is rewritten while nothing changes', () => {
  const { bag, session } = setup(createState(1));
  session.load();
  for (let n = 1; n <= SAVE_EVERY_TICKS * 3; n += 1) session.onTick(n);
  assert.equal(bag.writes, 0);
});

test('a refused action changes nothing, reaches the player and is logged with its code', () => {
  const {
    bag, cap, executed, session,
  } = setup(createState(1));
  session.load();
  session.dispatch({ type: 'setPhase', to: 'running', by: 'p1' });
  assert.equal(session.state?.phase, 'setup');
  assert.equal(bag.writes, 0);
  assert.deepEqual(executed.map((e) => [e.to, e.code]), [['p1', 'badPhase']]);
  assert.match(cap.find('refused')[0]?.line ?? '', /code=badPhase action=setPhase by=p1/);
});

test('a phase change is logged as an outcome', () => {
  const { cap, session } = setup(createState(1));
  session.load();
  session.dispatch({ type: 'setPhase', to: 'generating', by: 'host' });
  assert.match(cap.find('phaseChanged')[0]?.line ?? '', /from=setup to=generating by=host/);
});

test('actions before the world has loaded are ignored', () => {
  const { bag, executed, session } = setup();
  session.dispatch({ type: 'setPhase', to: 'generating', by: 'p1' });
  session.onTick(SAVE_EVERY_TICKS);
  assert.equal(session.state, undefined);
  assert.deepEqual([bag.writes, executed], [0, []]);
});

test('a save that fails part-way is made whole by the retry', () => {
  const { bag, session } = setup(createState(1));
  session.load();
  const bigName = 'x'.repeat(70_000);
  let writes = 0;
  const real = bag.set.bind(bag);
  bag.set = (key, value) => {
    writes += 1;
    if (writes === 2) throw new Error('write failed');
    real(key, value);
  };
  session.state = { ...createState(1), players: { p1: { name: bigName } } };
  session.dispatch({ type: 'setPhase', to: 'generating' });
  bag.set = real;
  session.onTick(SAVE_EVERY_TICKS);
  assert.equal(saved(bag).players.p1?.name, bigName);
  assert.equal(saved(bag).phase, 'generating');
});

test('a failed save is logged once, keeps the state in memory and is retried', () => {
  const { bag, cap, session } = setup({ ...createState(1), phase: 'running' });
  session.load(); // running → paused, saved
  bag.failWith = new Error('disk full');
  session.dispatch({ type: 'setPhase', to: 'running' });
  for (let n = 1; n <= SAVE_EVERY_TICKS * 2; n += 1) session.onTick(n);
  assert.equal(session.state?.clock, SAVE_EVERY_TICKS * 2);
  assert.equal(cap.find('saveFailed').length, 1);
  bag.failWith = undefined;
  session.onTick(SAVE_EVERY_TICKS * 3);
  assert.equal(saved(bag).clock, session.state?.clock);
  assert.equal(saved(bag).phase, 'running');
  assert.equal(cap.find('saveRecovered').length, 1);
});
