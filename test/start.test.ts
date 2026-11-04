// Race start (spec §8.1): who may start, what the start stores, the kit and countdown effects,
// the movement lock until GO, and the lights it sets (follow-up #36).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LogCapture } from './helpers/logCapture.js';
import { MapBag } from './helpers/mapBag.js';
import { boxOf, readyRace } from './helpers/race.js';
import { RACE } from '../src/core/config.js';
import { saveState } from '../src/core/persist.js';
import { reduce } from '../src/core/race/engine.js';
import { raceResumeEffects } from '../src/core/race/start.js';
import { Session } from '../src/core/session.js';

import type { Action, Effect, State } from '../src/core/types.js';

const snapshot = {
  rules: { keepInventory: false, showCoordinates: false, doDayLightCycle: true },
  time: 4321,
};
const everyone = ['h', 'b', 'c', 'd', 'e'];
const start = (by = 'h', online = everyone): Action => ({
  type: 'startRace', by, online, snapshot,
});
const of = <K extends Effect['kind']>(effects: Effect[], kind: K) => effects.filter(
  (e): e is Extract<Effect, { kind: K }> => e.kind === kind,
);

test('only the host starts, only from ready', () => {
  assert.equal(reduce(readyRace(), start('b')).refusal, 'notHost');
  assert.equal(reduce(readyRace('setup'), start()).refusal, 'badPhase');
  assert.equal(reduce(readyRace('running'), start()).refusal, 'badPhase');
});

test('start is refused while an arena is missing, and says which', () => {
  const state = readyRace();
  const stops = state.stops.map((s) => (s.id === 3 ? { ...s, built: false } : s));
  const out = reduce({ ...state, stops }, start());
  assert.equal(out.refusal, 'arenasMissing');
  assert.equal(out.state.phase, 'ready');
  assert.match(of(out.effects, 'notify')[0]?.text ?? '', /1 arena/);
});

test('start needs at least two teams', () => {
  const state = readyRace();
  const one = { ...state, teams: state.teams.slice(0, 1) };
  assert.equal(reduce(one, start()).refusal, 'tooFewTeams');
});

test('starting stores the plan, the snapshot once, and puts every team on leg 1 departing', () => {
  const out = reduce(readyRace(), start());
  const { state } = out;
  assert.equal(state.phase, 'running');
  assert.deepEqual(state.snapshot, snapshot);
  assert.equal(state.plan?.legs, state.plan?.legs);
  assert.ok(state.plan);
  assert.equal(state.day, 1);
  assert.deepEqual(state.leg, { n: 1, phase: 'departing' });
  for (const t of state.teams) {
    assert.equal(t.leg, 1);
    assert.equal(t.step, 0);
    assert.equal(t.lastClearedStop, 0);
    assert.equal(t.departAt, state.clock + RACE.countdownTicks);
  }
});

test('lights: whatever the debug command left is cleared and only leg 1 is lit', () => {
  const base = readyRace();
  const stops = base.stops.map((s) => ({ ...s, lit: s.leg === 2 || s.id === 0 }));
  const out = reduce({ ...base, stops }, start());
  assert.deepEqual(out.state.stops.map((s) => s.lit), out.state.stops.map((s) => s.leg === 1));
  const [light] = of(out.effects, 'lightStops');
  assert.equal(light?.sites.length, out.state.stops.length);
  assert.deepEqual(light?.sites.map((s) => s.lit), out.state.stops.map((s) => s.leg === 1));
});

test('online racers get the kit at ring spots around the start; offline ones are skipped', () => {
  const out = reduce(readyRace(), start('h', ['h', 'b', 'c', 'e']));
  const [kit] = of(out.effects, 'startRacers');
  assert.deepEqual(kit?.racers.map((r) => r.id), ['h', 'b', 'c']);
  assert.deepEqual(kit?.racers.map((r) => r.color), ['§c', '§c', '§9']);
  assert.equal(kit?.time, RACE.dayTime);
  assert.equal(kit?.daylight, true);
  const spots = new Set(kit?.racers.map((r) => `${r.spawn.x},${r.spawn.z}`));
  assert.equal(spots.size, 3);
  for (const r of kit?.racers ?? []) {
    assert.equal(r.spawn.y, 71);
    assert.ok(Math.abs(Math.hypot(r.spawn.x, r.spawn.z) - RACE.ringRadius) < 1);
  }
});

test('with the day-night cycle off the time is fixed at noon', () => {
  const base = readyRace();
  const out = reduce({ ...base, settings: { ...base.settings, daylightCycle: false } }, start());
  const [kit] = of(out.effects, 'startRacers');
  assert.equal(kit?.time, RACE.fixedTime);
  assert.equal(kit?.daylight, false);
});

test('Passport for every racer; the host who races gets Race Control back after the clear', () => {
  const out = reduce(readyRace(), start());
  const gives = of(out.effects, 'giveItem').map((e) => `${e.to}:${e.item}`);
  assert.deepEqual(gives.filter((g) => g.endsWith('passport')).sort(), [
    'b:passport', 'c:passport', 'd:passport', 'h:passport']);
  assert.deepEqual(gives.filter((g) => g.endsWith('raceControl')), ['h:raceControl']);
  const kinds = out.effects.map((e) => e.kind);
  assert.ok(kinds.indexOf('startRacers') < kinds.indexOf('giveItem'));
});

test('a host who does not race keeps their items', () => {
  const base = readyRace();
  const [red, blue] = base.teams;
  const state = {
    ...base,
    settings: { ...base.settings, hostRaces: false },
    teams: [{ ...red, members: ['b'] }, blue] as State['teams'],
  };
  const out = reduce(state, start());
  assert.deepEqual(of(out.effects, 'giveItem').filter((e) => e.item === 'raceControl'), []);
  assert.ok(!of(out.effects, 'startRacers')[0]?.racers.some((r) => r.id === 'h'));
});

test('movement is locked, start and leg 1 are announced, each team gets its first clue', () => {
  const out = reduce(readyRace(), start());
  const lock = of(out.effects, 'lockMovement')[0];
  assert.deepEqual([lock?.locked, [...(lock?.players ?? [])].sort()], [true, ['b', 'c', 'd', 'h']]);
  assert.equal(of(out.effects, 'broadcast').length, 2);
  const clues = of(out.effects, 'title').filter((e) => e.chat);
  assert.deepEqual(clues.map((c) => c.to), [['h', 'b'], ['c', 'd']]);
  assert.match(clues[0]?.text ?? '', /^Leg 1 · Route Info — .*Place 1 \(X 100, Z −10\)/);
  assert.equal(of(out.effects, 'sidebar').length, 1);
});

test('the clock counts while departing, and GO releases the teams when the countdown ends', () => {
  let state: State = reduce(readyRace(), start()).state;
  for (let i = 0; i < RACE.countdownTicks - 1; i += 1) {
    const out = reduce(state, { type: 'tick' });
    assert.deepEqual(out.effects, []);
    state = out.state;
  }
  assert.equal(state.leg.phase, 'departing');
  const out = reduce(state, { type: 'tick' });
  assert.equal(out.state.leg.phase, 'racing');
  assert.ok(out.state.teams.every((t) => t.departAt === undefined));
  const unlock = of(out.effects, 'lockMovement')[0];
  assert.equal(unlock?.locked, false);
  assert.equal(of(out.effects, 'title')[0]?.text, 'GO!');
});

test('a reload in the countdown locks movement again; later phases refresh the sidebar', () => {
  const departing = reduce(readyRace(), start()).state;
  const kinds = (s: State) => raceResumeEffects(s).map((e) => e.kind);
  assert.deepEqual(kinds(departing), ['lockMovement', 'sidebar']);
  const released = {
    ...departing,
    leg: { n: 1, phase: 'racing' as const },
    teams: departing.teams.map(({ departAt, ...t }) => t),
  };
  assert.deepEqual(kinds(released), ['sidebar']);
  assert.deepEqual(kinds(readyRace()), []);
});

test('Ready to Running cannot be forced around the start rules', () => {
  const out = reduce(readyRace(), { type: 'setPhase', to: 'running', by: 'h' });
  assert.equal(out.refusal, 'useStartRace');
});

test('a crowd of racers stays inside the arena ring and still gets a spot each', () => {
  const base = readyRace();
  const many = Array.from({ length: 40 }, (_, i) => `p${i}`);
  const [red, blue] = base.teams;
  const state = { ...base, teams: [{ ...red, members: many }, blue] as State['teams'] };
  const [kit] = of(reduce(state, start('h', many)).effects, 'startRacers');
  assert.equal(kit?.racers.length, 40);
  for (const r of kit?.racers ?? []) assert.ok(Math.hypot(r.spawn.x, r.spawn.z) <= 7.5);
});

test('with nobody online the race still starts, with no kit to give', () => {
  const out = reduce(readyRace(), start('h', []));
  assert.equal(out.refusal, undefined);
  assert.deepEqual(of(out.effects, 'startRacers')[0]?.racers, []);
});

test('a world reloaded in the countdown re-locks movement through the session', () => {
  const bag = new MapBag();
  saveState(bag, reduce(readyRace(), start()).state);
  const executed: Effect[] = [];
  const session = new Session({
    bag, sink: new LogCapture().sink, execute: (e) => executed.push(...e), newSeed: () => 1,
  });
  session.load();
  assert.equal(session.state?.phase, 'paused');
  assert.deepEqual(executed.map((e) => e.kind).filter((k) => k !== 'lightStops'), [
    'daylight', 'lockMovement', 'sidebar']);
});

test('a first playable race: start, count down, clear Route Info, get the next clue', () => {
  let { state } = reduce(readyRace(), start());
  for (let i = 0; i < RACE.countdownTicks; i += 1) state = reduce(state, { type: 'tick' }).state;
  const box = boxOf(state, 1);
  const together = ['h', 'b'].map((id) => ({ id, pos: { ...box, x: box.x + 1 } }));
  const out = reduce(state, {
    type: 'interactClue', player: 'b', pos: box, members: together,
  });
  assert.equal(out.refusal, undefined);
  const next = of(out.effects, 'title')[0];
  assert.match(next?.text ?? '', /^Leg 1 · Detour — /);
  assert.equal(out.state.teams[0]?.step, 1);
});
