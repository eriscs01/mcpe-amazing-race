// Course generation actions (spec §4, §6): pins, starting a job, its result, and discarding a
// course. The job itself runs in the adapter; the core decides what each message does.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LogCapture } from './helpers/logCapture.js';
import { MapBag } from './helpers/mapBag.js';
import {
  failureText, GENERATE_PHASES, LIST_PHASES, stopList,
} from '../src/core/generation.js';
import { saveState } from '../src/core/persist.js';
import { reduce } from '../src/core/race/engine.js';
import { Session } from '../src/core/session.js';
import { createState } from '../src/core/state.js';

import type {
  Action, GenerationFailure, Phase, State, Stop, Team,
} from '../src/core/types.js';

const hosted = (phase: Phase = 'setup', over: Partial<State> = {}): State => ({
  ...createState(5), hostId: 'h', players: { h: { name: 'Hana' } }, phase, ...over,
});
const at = { x: 10.7, y: 70, z: -4.2 };
const stop = (id: number): Stop => ({
  id,
  leg: 1,
  type: 'route',
  pos: { x: id * 700, y: 70, z: 0 },
  terrain: 'plains',
  name: `Amber Rise ${id}`,
  blind: false,
  built: false,
  lit: false,
});

test('the host adds a landmark in setup; it is stored on whole blocks', () => {
  const out = reduce(hosted(), { type: 'addPin', by: 'h', pos: at });
  assert.deepEqual(out.state.pins, [{ x: 10, y: 70, z: -5 }]);
  assert.equal(out.refusal, undefined);
  assert.equal(out.effects[0]?.kind, 'notify');
});

test('a landmark is refused from a non-host and once the course exists', () => {
  assert.equal(reduce(hosted(), { type: 'addPin', by: 'x', pos: at }).refusal, 'notHost');
  assert.equal(reduce(hosted('ready'), { type: 'addPin', by: 'h', pos: at }).refusal, 'badPhase');
});

test('landmarks can be cleared in setup', () => {
  const state = hosted('setup', { pins: [at] });
  assert.deepEqual(reduce(state, { type: 'clearPins', by: 'h' }).state.pins, []);
  assert.equal(reduce(state, { type: 'clearPins', by: 'x' }).refusal, 'notHost');
});

test('generating from setup starts job 1 with the plan, the seed and the host position', () => {
  const state = hosted('setup', { pins: [{ x: 800, y: 70, z: 0 }] });
  const out = reduce(state, { type: 'startGeneration', by: 'h', start: at });
  assert.equal(out.state.phase, 'generating');
  assert.equal(out.state.job, 1);
  const effect = out.effects.find((e) => e.kind === 'generateCourse');
  assert.deepEqual(effect, {
    kind: 'generateCourse',
    job: 1,
    start: { x: 10, y: 70, z: -5 },
    pins: [{ x: 800, y: 70, z: 0 }],
    legs: 6,
    radius: 1800,
    seed: 5,
  });
});

test('generating is for the host, in setup or ready only', () => {
  const go = (s: State, by = 'h') => reduce(s, { type: 'startGeneration', by, start: at });
  assert.equal(go(hosted(), 'x').refusal, 'notHost');
  assert.equal(go(hosted('running')).refusal, 'badPhase');
  assert.equal(go(hosted('generating')).refusal, 'badPhase');
  for (const phase of GENERATE_PHASES) assert.equal(go(hosted(phase)).refusal, undefined);
});

test('generating again from ready keeps the old course until the new one arrives', () => {
  const state = hosted('ready', { stops: [stop(0), stop(1)], job: 1, start: at });
  const out = reduce(state, { type: 'startGeneration', by: 'h', start: at });
  assert.equal(out.state.job, 2);
  assert.equal(out.state.stops.length, 2);
});

const generated = (job: number, stops: Stop[]): Action => ({
  type: 'courseGenerated', job, start: at, stops, inserted: 1,
});

test('a finished job stores the course and makes the race ready', () => {
  const { state } = reduce(hosted(), { type: 'startGeneration', by: 'h', start: at });
  const out = reduce(state, generated(1, [stop(0), stop(1)]));
  assert.equal(out.state.phase, 'ready');
  assert.deepEqual(out.state.start, at);
  assert.equal(out.state.stops.length, 2);
  assert.equal(out.logs?.[0]?.event, 'courseGenerated');
  assert.equal(out.effects[0]?.kind, 'notify');
});

test('a late result from an old or abandoned job is refused', () => {
  const { state } = reduce(hosted(), { type: 'startGeneration', by: 'h', start: at });
  assert.equal(reduce(state, generated(0, [stop(0)])).refusal, 'staleJob');
  assert.equal(reduce(hosted('ready'), generated(1, [stop(0)])).refusal, 'staleJob');
  assert.equal(
    reduce(state, {
      type: 'courseFailed',
      job: 9,
      failure: {
        reason: 'noRoom', stop: 2, leg: 1, type: 'route',
      },
    }).refusal,
    'staleJob',
  );
});

const failing = (state: State, failure: GenerationFailure) => reduce(
  reduce(state, { type: 'startGeneration', by: 'h', start: at }).state,
  { type: 'courseFailed', job: (state.job ?? 0) + 1, failure },
);

test('a load timeout tells the host the terrain did not load, not that it is bad', () => {
  const out = failing(hosted(), {
    reason: 'loadTimeout', stop: 3, leg: 1, type: 'detour',
  });
  const note = out.effects[0];
  assert.match(note?.kind === 'notify' ? note.text : '', /did not load in time/);
  assert.doesNotMatch(note?.kind === 'notify' ? note.text : '', /water or steep/);
});

test('a failed first job returns to setup and tells the host why', () => {
  const out = failing(hosted(), {
    reason: 'noGround', stop: 3, leg: 1, type: 'detour',
  });
  assert.equal(out.state.phase, 'setup');
  const note = out.effects[0];
  assert.equal(note?.kind === 'notify' && note.to, 'h');
  assert.equal(out.logs?.[0]?.event, 'courseFailed');
});

test('a failed re-run keeps the earlier course and returns to ready', () => {
  const state = hosted('ready', { stops: [stop(0), stop(1)], job: 1 });
  const out = failing(state, { reason: 'tickingAreaFull' });
  assert.equal(out.state.phase, 'ready');
  assert.equal(out.state.stops.length, 2);
});

test('failure messages say what to change', () => {
  const text = (f: GenerationFailure) => failureText(f, 1800);
  assert.match(text({ reason: 'tickingAreaFull' }), /remove one/i);
  assert.match(text({ reason: 'pinOutsideCourse', pin: 1 }), /landmark 2.*1,?800/i);
  assert.match(text({ reason: 'pinTooClose', pin: 0 }), /landmark 1.*300/i);
  assert.match(text({ reason: 'tooManyPins', pin: 4 }), /landmark 5/i);
  assert.match(text({
    reason: 'noRoom', stop: 4, leg: 2, type: 'finish',
  }), /room.*finish/i);
  assert.match(text({
    reason: 'noGround', stop: 4, leg: 2, type: 'detour',
  }), /ground/i);
  assert.match(text({ reason: 'error' }), /Content Log/);
});

test('discarding the course in ready returns to setup, keeping landmarks and teams', () => {
  const state = hosted('ready', {
    stops: [stop(0)],
    start: at,
    pins: [at],
    teams: [{ id: 't1' } as Team],
  });
  const out = reduce(state, { type: 'discardCourse', by: 'h' });
  assert.equal(out.state.phase, 'setup');
  assert.deepEqual(out.state.stops, []);
  assert.equal(out.state.start, undefined);
  assert.equal(out.state.pins.length, 1);
  assert.equal(out.state.teams.length, 1);
  assert.equal(reduce(hosted('running'), { type: 'discardCourse', by: 'h' }).refusal, 'badPhase');
  assert.equal(reduce(state, { type: 'discardCourse', by: 'x' }).refusal, 'notHost');
});

test('the stop list is for the host and shown only while the course is still secret', () => {
  assert.deepEqual([...LIST_PHASES], ['ready']);
});

function loaded(state: State) {
  const bag = new MapBag();
  saveState(bag, state);
  const cap = new LogCapture();
  const session = new Session({
    bag, sink: cap.sink, execute: () => undefined, newSeed: () => 1,
  });
  session.load();
  return { session, cap };
}

test('a world that closed mid-generation comes back in setup, or ready if a course exists', () => {
  const first = loaded(hosted('generating', { job: 1 }));
  assert.equal(first.session.state?.phase, 'setup');
  assert.equal(first.cap.find('generationAbandonedOnLoad').length, 1);
  const rerun = loaded(hosted('generating', { job: 2, stops: [stop(0)] }));
  assert.equal(rerun.session.state?.phase, 'ready');
});

test('the stop list shows leg, type, name and coordinates, and notes a landmark', () => {
  const state = hosted('ready', {
    stops: [
      { ...stop(0), type: 'start', leg: 0 },
      { ...stop(1), landmark: { kind: 'village', pos: { x: 0, y: 70, z: 0 } } },
    ],
  });
  assert.equal(
    stopList(state),
    'Start · Start line · Amber Rise 0 · 0, 70, 0\n'
    + 'Leg 1 · Route Info · Amber Rise 1 (village) · 700, 70, 0',
  );
  assert.match(stopList(hosted()), /No course yet/);
});
