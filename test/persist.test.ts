import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MapBag } from './helpers/mapBag.js';
import {
  CHUNK_BYTES, chunkKey, COUNT_KEY, loadState, saveState, splitChunks,
} from '../src/core/persist.js';
import { createState } from '../src/core/state.js';

import type { State, Team } from '../src/core/types.js';

const bytes = (s: string): number => new TextEncoder().encode(s).length;

/** A state well over one chunk: many teams with long progress maps and non-ASCII text. */
function bigState(): State {
  const team = (i: number): Team => ({
    id: `t${i}`,
    name: `§cTeam ✦ ${i}`,
    color: '§c',
    members: [`p${i}a`, `p${i}b`],
    status: 'racing',
    leg: 3,
    step: 2,
    penaltyOwed: 0,
    checkIns: [{ leg: 1, clock: 1200, place: 1 }],
    roadblockCounts: {},
    uTurnUsed: false,
    speedBump: false,
    progress: Object.fromEntries(
      Array.from({ length: 300 }, (_, k) => [`${k}:a`, { hits: k, ok: 1 }]),
    ),
    lastClearedStop: 4,
  });
  return {
    ...createState(99),
    phase: 'running',
    clock: 48210,
    teams: Array.from({ length: 12 }, (_, i) => team(i)),
  };
}

test('state survives a save and load round trip', () => {
  const bag = new MapBag();
  const state = bigState();
  saveState(bag, state);
  assert.deepEqual(loadState(bag), { kind: 'loaded', state });
});

test('large state is split into several chunks, each within the size limit', () => {
  const bag = new MapBag();
  saveState(bag, bigState());
  const count = bag.get(COUNT_KEY);
  assert.ok(typeof count === 'number' && count > 1);
  for (let i = 0; i < count; i += 1) {
    const chunk = bag.get(chunkKey(i));
    assert.ok(typeof chunk === 'string' && bytes(chunk) <= CHUNK_BYTES, `chunk ${i}`);
  }
});

test('chunks never split a character, so non-BMP text survives', () => {
  const text = `${'😀'.repeat(20)}x`;
  const chunks = splitChunks(text, 7);
  assert.equal(chunks.join(''), text);
  for (const c of chunks) {
    assert.ok(bytes(c) <= 7);
    assert.ok(!/[\uD800-\uDBFF]$/.test(c), 'chunk ends in half a surrogate pair');
  }
});

test('an empty string is one empty chunk', () => {
  assert.deepEqual(splitChunks('', 10), ['']);
});

test('saving a smaller state removes the chunks it no longer uses', () => {
  const bag = new MapBag();
  saveState(bag, bigState());
  saveState(bag, createState(1));
  assert.deepEqual([...bag.map.keys()].sort(), [COUNT_KEY, chunkKey(0)].sort());
  assert.deepEqual(loadState(bag), { kind: 'loaded', state: createState(1) });
});

test('a world with no saved race loads as empty', () => {
  assert.deepEqual(loadState(new MapBag()), { kind: 'empty' });
});

test('fields added after a save get their defaults on load', () => {
  const bag = new MapBag();
  const old: Partial<State> = { ...createState(7), phase: 'ready' };
  delete old.pins;
  const { daylightCycle, ...oldSettings } = createState(7).settings;
  bag.set(COUNT_KEY, 1);
  bag.set(chunkKey(0), JSON.stringify({ ...old, settings: oldSettings }));
  const out = loadState(bag);
  assert.equal(out.kind, 'loaded');
  if (out.kind !== 'loaded') return;
  assert.deepEqual(out.state.pins, []);
  assert.equal(out.state.settings.daylightCycle, daylightCycle);
  assert.equal(out.state.phase, 'ready');
  assert.equal(out.state.seed, 7);
});

const corrupt: [string, (bag: MapBag) => void][] = [
  ['badCount', (bag) => bag.set(COUNT_KEY, 'two')],
  ['badCount', (bag) => bag.set(COUNT_KEY, 0)],
  ['missingChunk', (bag) => {
    bag.set(COUNT_KEY, 2);
    bag.set(chunkKey(0), '{}');
  }],
  ['badJson', (bag) => {
    bag.set(COUNT_KEY, 1);
    bag.set(chunkKey(0), '{"v":1,');
  }],
  ['notObject', (bag) => {
    bag.set(COUNT_KEY, 1);
    bag.set(chunkKey(0), '[1]');
  }],
  ['badVersion', (bag) => {
    bag.set(COUNT_KEY, 1);
    bag.set(chunkKey(0), '{"phase":"setup"}');
  }],
  ['newerSchema', (bag) => {
    bag.set(COUNT_KEY, 1);
    bag.set(chunkKey(0), '{"v":2}');
  }],
];

for (const [reason, damage] of corrupt) {
  test(`unreadable saves are reported as ${reason}, not replaced`, () => {
    const bag = new MapBag();
    damage(bag);
    const before = new Map(bag.map);
    assert.deepEqual(loadState(bag), { kind: 'corrupt', reason });
    assert.deepEqual(bag.map, before);
  });
}
