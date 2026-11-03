// Arena state (spec §6.5-6.6): what building, lighting and their failures change, and what the
// session asks the adapter to redo after a reload.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LogCapture } from './helpers/logCapture.js';
import { MapBag } from './helpers/mapBag.js';
import {
  allArenasBuilt, parseLightCommand, resumeEffects,
} from '../src/core/arenas.js';
import { hostMenu } from '../src/core/menu.js';
import { saveState } from '../src/core/persist.js';
import { reduce } from '../src/core/race/engine.js';
import { Session } from '../src/core/session.js';
import { createState } from '../src/core/state.js';

import type {
  Action, Effect, Phase, State, Stop,
} from '../src/core/types.js';

const at = { x: 10, y: 70, z: -5 };
const stop = (id: number, over: Partial<Stop> = {}): Stop => ({
  id,
  leg: Math.max(1, id),
  type: id === 0 ? 'start' : 'route',
  pos: { x: id * 700, y: 70, z: 0 },
  terrain: 'plains',
  name: `Amber Rise ${id}`,
  blind: false,
  built: false,
  lit: false,
  ...over,
});
const hosted = (phase: Phase, stops: Stop[], over: Partial<State> = {}): State => ({
  ...createState(5), hostId: 'h', players: { h: { name: 'Hana' } }, phase, stops, job: 3, ...over,
});
const built = (job = 3, id = 0, y = 70): Action => ({
  type: 'arenaBuilt', job, stop: id, y, existing: false,
});
const kinds = (effects: Effect[]) => effects.map((e) => e.kind);
const wishes = (e: Effect | undefined) => (
  e?.kind === 'lightStops' ? e.sites.map((s) => [s.id, s.lit]) : undefined);

test('a finished course asks the adapter to build every arena for that job', () => {
  const generating = hosted('generating', [], { job: 3 });
  const out = reduce(generating, {
    type: 'courseGenerated', job: 3, start: at, stops: [stop(0), stop(1)], inserted: 0,
  });
  const build = out.effects.find((e) => e.kind === 'buildArenas');
  assert.deepEqual(build, {
    kind: 'buildArenas',
    job: 3,
    sites: [
      { id: 0, pos: { x: 0, y: 70, z: 0 }, type: 'start' },
      { id: 1, pos: { x: 700, y: 70, z: 0 }, type: 'route' },
    ],
  });
});

test('a built arena is marked, its ground height corrected, and its lights set to the wish', () => {
  const state = hosted('ready', [stop(0), stop(1, { lit: true })]);
  const out = reduce(state, built(3, 1, 68));
  assert.equal(out.refusal, undefined);
  assert.equal(out.state.stops[1]?.built, true);
  assert.equal(out.state.stops[1]?.pos.y, 68);
  assert.equal(out.state.stops[0]?.built, false);
  const light = out.effects.find((e) => e.kind === 'lightStops');
  assert.deepEqual(light, {
    kind: 'lightStops',
    sites: [{
      id: 1, pos: { x: 700, y: 68, z: 0 }, type: 'route', lit: true,
    }],
  });
  assert.equal(out.logs?.[0]?.event, 'arenaBuilt');
});

test('the host hears once when the last arena is built', () => {
  const state = hosted('ready', [stop(0, { built: true }), stop(1)]);
  const out = reduce(state, built(3, 1));
  assert.equal(allArenasBuilt(out.state), true);
  assert.ok(out.effects.some((e) => e.kind === 'notify' && /arenas are built/i.test(e.text)));
  const first = reduce(hosted('ready', [stop(0), stop(1)]), built(3, 0));
  assert.ok(!first.effects.some((e) => e.kind === 'notify'));
});

test('a build result for an older course, a missing stop or another phase is refused', () => {
  const state = hosted('ready', [stop(0)]);
  assert.equal(reduce(state, built(2)).refusal, 'staleJob');
  assert.equal(reduce(state, built(3, 9)).refusal, 'unknownStop');
  assert.equal(reduce(hosted('generating', [stop(0)]), built()).refusal, 'staleJob');
  assert.equal(reduce(hosted('ready', []), built()).refusal, 'unknownStop');
});

test('a failed build tells the host what to do and leaves the stop unbuilt', () => {
  const state = hosted('ready', [stop(0), stop(1)]);
  const out = reduce(state, {
    type: 'arenaBuildFailed', job: 3, stop: 1, reason: 'timeout',
  });
  assert.equal(out.state.stops[1]?.built, false);
  const note = out.effects.find((e) => e.kind === 'notify');
  assert.match(note?.kind === 'notify' ? note.text : '', /Build arenas/);
  assert.equal(out.logs?.[0]?.event, 'arenaBuildFailed');
  assert.equal(
    reduce(state, {
      type: 'arenaBuildFailed', job: 1, stop: 1, reason: 'error',
    }).refusal,
    'staleJob',
  );
});

test('a full ticking-area list is explained as such', () => {
  const out = reduce(hosted('ready', [stop(0)]), {
    type: 'arenaBuildFailed', job: 3, stop: 0, reason: 'tickingAreaFull',
  });
  const note = out.effects.find((e) => e.kind === 'notify');
  assert.match(note?.kind === 'notify' ? note.text : '', /ticking area/i);
});

test('Build arenas (host, ready) asks again for the unbuilt stops only', () => {
  const state = hosted('ready', [stop(0, { built: true }), stop(1)]);
  const out = reduce(state, { type: 'buildArenas', by: 'h' });
  const build = out.effects.find((e) => e.kind === 'buildArenas');
  assert.deepEqual(build?.kind === 'buildArenas' && build.sites.map((s) => s.id), [1]);
  assert.equal(reduce(state, { type: 'buildArenas', by: 'x' }).refusal, 'notHost');
  const running = { ...state, phase: 'running' as const };
  assert.equal(reduce(running, { type: 'buildArenas', by: 'h' }).refusal, 'badPhase');
});

test('Build arenas with nothing left to build only says so', () => {
  const out = reduce(hosted('ready', [stop(0, { built: true })]), { type: 'buildArenas', by: 'h' });
  assert.deepEqual(kinds(out.effects), ['notify']);
});

test('the menu offers Build arenas only while some arena is unbuilt', () => {
  const offered = (stops: Stop[]) => hostMenu(hosted('ready', stops)).buttons.map((b) => b.command);
  assert.ok(offered([stop(0), stop(1, { built: true })]).includes('buildArenas'));
  assert.ok(!offered([stop(0, { built: true })]).includes('buildArenas'));
  assert.ok(!offered([]).includes('buildArenas'));
});

test('lighting stops sets the wish for all named stops and relights only the built ones', () => {
  const state = hosted('ready', [stop(0, { built: true }), stop(1)]);
  const out = reduce(state, { type: 'setLit', stops: [0, 1], lit: true });
  assert.deepEqual(out.state.stops.map((s) => s.lit), [true, true]);
  const light = out.effects.find((e) => e.kind === 'lightStops');
  assert.deepEqual(wishes(light), [[0, true]]);
});

test('"all" lights every stop; an unknown stop is refused', () => {
  const state = hosted('ready', [stop(0, { built: true }), stop(1, { built: true })]);
  const out = reduce(state, { type: 'setLit', stops: 'all', lit: true });
  assert.deepEqual(out.state.stops.map((s) => s.lit), [true, true]);
  assert.equal(reduce(state, { type: 'setLit', stops: [7], lit: true }).refusal, 'unknownStop');
});

test('a person lighting stops must be the host, before the race starts', () => {
  const state = hosted('ready', [stop(0, { built: true })]);
  assert.equal(reduce(state, {
    type: 'setLit', stops: [0], lit: true, by: 'x',
  }).refusal, 'notHost');
  assert.equal(
    reduce({ ...state, phase: 'running' }, {
      type: 'setLit', stops: [0], lit: true, by: 'h',
    }).refusal,
    'badPhase',
  );
  assert.equal(reduce(state, {
    type: 'setLit', stops: [0], lit: true, by: 'h',
  }).refusal, undefined);
  assert.equal(
    reduce({ ...state, phase: 'running' }, { type: 'setLit', stops: [0], lit: true }).refusal,
    undefined,
  );
});

test('a debug light command names a stop or all, and on or off', () => {
  assert.deepEqual(parseLightCommand('3 on'), { stops: [3], lit: true });
  assert.deepEqual(parseLightCommand(' all   off '), { stops: 'all', lit: false });
  for (const bad of ['', 'on', '3', 'x on', '3 maybe', '-1 on', '1.5 on', '3 on extra']) {
    assert.equal(parseLightCommand(bad), undefined, bad);
  }
});

test('after a reload: unbuilt arenas are built again and every built stop is relit', () => {
  const state = hosted('ready', [stop(0, { built: true, lit: true }), stop(1)]);
  const effects = resumeEffects(state);
  assert.deepEqual(kinds(effects), ['buildArenas', 'lightStops']);
  const light = effects.find((e) => e.kind === 'lightStops');
  assert.deepEqual(wishes(light), [[0, true]]);
});

test('after a reload mid-race only the lights are restored; builds are not restarted', () => {
  for (const phase of ['running', 'paused', 'dayEnded'] as const) {
    const effects = resumeEffects(hosted(phase, [stop(0, { built: true }), stop(1)]));
    assert.deepEqual(kinds(effects), ['lightStops'], phase);
  }
  assert.deepEqual(resumeEffects(hosted('setup', [])), []);
  assert.deepEqual(resumeEffects(hosted('generating', [stop(0)])), []);
});

test('the session hands the adapter the resume effects when the world loads', () => {
  const bag = new MapBag();
  saveState(bag, hosted('ready', [stop(0, { built: true }), stop(1)]));
  const executed: Effect[] = [];
  const session = new Session({
    bag, sink: new LogCapture().sink, execute: (e) => executed.push(...e), newSeed: () => 1,
  });
  session.load();
  assert.deepEqual(kinds(executed), ['buildArenas', 'lightStops']);
});

test('a fresh world resumes nothing', () => {
  const executed: Effect[] = [];
  const session = new Session({
    bag: new MapBag(),
    sink: new LogCapture().sink,
    execute: (e) => executed.push(...e),
    newSeed: () => 1,
  });
  session.load();
  assert.deepEqual(executed, []);
});

test('discard and a new course: a stale build result from before is refused (#32)', () => {
  const state = hosted('ready', [stop(0), stop(1)], { job: 3 });
  const discarded = reduce(state, { type: 'discardCourse', by: 'h' }).state;
  assert.equal(reduce(discarded, built(3, 1)).refusal, 'staleJob');
  const again = reduce(discarded, { type: 'startGeneration', by: 'h', start: at }).state;
  assert.equal(again.job, 4);
  assert.equal(reduce(again, built(3, 1)).refusal, 'staleJob');
});
