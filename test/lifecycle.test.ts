// Sessions (spec §11): pause, ending and resuming a day, the automatic day end, the reminder.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { matOf, onMat, pitRace } from './helpers/race.js';
import { RACE } from '../src/core/config.js';
import { reduce } from '../src/core/race/engine.js';
import { lockedPlayers } from '../src/core/race/locks.js';
import { raceResumeEffects } from '../src/core/race/start.js';

import type {
  Action, Effect, State, Team,
} from '../src/core/types.js';

const of = <K extends Effect['kind']>(effects: Effect[], kind: K) => effects.filter(
  (e): e is Extract<Effect, { kind: K }> => e.kind === kind,
);
const teamOf = (state: State, id: string): Team => {
  const found = state.teams.find((t) => t.id === id);
  if (!found) throw new Error(`no team ${id}`);
  return found;
};
const go = (state: State, action: Action) => reduce(state, action);
const ticks = (from: State, n: number): State => Array.from({ length: n })
  .reduce<State>((s) => reduce(s, { type: 'tick' }).state, from);
const locksOf = (effects: Effect[], locked: boolean): string[] => of(effects, 'lockMovement')
  .filter((e) => e.locked === locked).flatMap((e) => e.players);

test('pause: only the host, locks every racer, stops the daylight and the clock', () => {
  const state = pitRace();
  assert.equal(go(state, { type: 'pauseRace', by: 'b' }).refusal, 'notHost');
  const out = go(state, { type: 'pauseRace', by: 'h' });
  assert.equal(out.state.phase, 'paused');
  assert.deepEqual(locksOf(out.effects, true).sort(), ['b', 'c', 'd', 'f', 'g', 'h']);
  assert.deepEqual(of(out.effects, 'daylight'), [{ kind: 'daylight', running: false }]);
  assert.equal(ticks(out.state, 5).clock, state.clock);
  assert.equal(go(out.state, { type: 'pauseRace', by: 'h' }).refusal, 'badPhase');
});

test('unpause frees the racers but keeps a countdown or the mat locked', () => {
  const state = pitRace();
  const held: State = {
    ...state,
    teams: state.teams.map((t) => (t.id === 'red' ? { ...t, departAt: state.clock + 100 } : t)),
  };
  const paused = go(held, { type: 'pauseRace', by: 'h' }).state;
  const out = go(paused, { type: 'unpauseRace', by: 'h' });
  assert.equal(out.state.phase, 'running');
  assert.deepEqual(locksOf(out.effects, false).sort(), ['c', 'd', 'f', 'g']);
  assert.deepEqual(locksOf(out.effects, true).sort(), ['b', 'h']);
  assert.deepEqual(of(out.effects, 'daylight'), [{ kind: 'daylight', running: true }]);
  assert.deepEqual(lockedPlayers(out.state).sort(), ['b', 'h']);
});

test('a paused race that is reloaded locks everyone and keeps the daylight stopped', () => {
  const paused = go(pitRace(), { type: 'pauseRace', by: 'h' }).state;
  const effects = raceResumeEffects(paused);
  assert.deepEqual(locksOf(effects, true).sort(), ['b', 'c', 'd', 'f', 'g', 'h']);
  assert.ok(of(effects, 'daylight').some((e) => !e.running));
});

test('End day by the host keeps positions, drops old ones, stops the daylight', () => {
  const state = pitRace();
  const old: State = {
    ...state,
    players: { ...state.players, b: { name: 'Ben', teamId: 'red', savedPos: { x: 1, y: 1, z: 1 } } },
  };
  const out = go(old, {
    type: 'endDay',
    by: 'h',
    positions: [{ id: 'h', pos: { x: 5, y: 70, z: 5 } }, { id: 'b' }],
  });
  assert.equal(out.state.phase, 'dayEnded');
  assert.deepEqual(out.state.players.h?.savedPos, { x: 5, y: 70, z: 5 });
  assert.equal(out.state.players.b?.savedPos, undefined);
  assert.deepEqual(of(out.effects, 'daylight'), [{ kind: 'daylight', running: false, save: true }]);
  assert.equal(go(out.state, { type: 'endDay', by: 'h', positions: [] }).refusal, 'badPhase');
  const saved = go(out.state, { type: 'dayTimeSaved', time: 13000 }).state;
  assert.equal(saved.dayTime, 13000);
  assert.equal(go(state, { type: 'dayTimeSaved', time: 1 }).state.dayTime, undefined);
});

/** Everyone has checked in at leg 1's Pit Stop; the next tick ends the leg and starts the rest. */
function resting(days = 2): State {
  const base = pitRace(false);
  const state: State = {
    ...base,
    settings: { ...base.settings, days },
    plan: {
      legs: 6, legsPerDay: 1, radius: 400, eliminationLegs: [],
    },
  };
  return [onMat(state, 4, ['h', 'b']), onMat(state, 4, ['c', 'd']), onMat(state, 4, ['f', 'g'])]
    .reduce<State>((acc, a) => reduce(acc, a).state, state);
}

test('the day ends by itself when the rest begins after the day\'s planned legs', () => {
  const out = reduce(resting(), { type: 'tick' });
  assert.equal(out.state.phase, 'dayEnded');
  assert.ok(of(out.effects, 'broadcast').some((e) => e.text.includes('Day 1 complete')));
  assert.ok(of(out.effects, 'daylight').some((e) => e.save));
});

test('the last day never ends by itself, nor does a day with legs left', () => {
  assert.equal(reduce(resting(1), { type: 'tick' }).state.phase, 'running');
  const state = resting();
  const more: State = { ...state, plan: { ...(state.plan as NonNullable<State['plan']>), legsPerDay: 3 } };
  assert.equal(reduce(more, { type: 'tick' }).state.phase, 'running');
});

test('resume at a Pit Stop: teams go to their mat, the departures go on, no second end', () => {
  const ended = reduce(resting(), { type: 'tick' }).state;
  const out = go({ ...ended, dayTime: 18000 }, { type: 'resumeDay', by: 'h' });
  assert.equal(out.state.phase, 'running');
  assert.equal(out.state.day, 2);
  assert.equal(out.state.dayStartLeg, 2);
  assert.equal(out.state.dayTime, undefined);
  assert.deepEqual(of(out.effects, 'daylight'), [{ kind: 'daylight', running: true, time: 18000 }]);
  const red = teamOf(out.state, 'red');
  assert.equal(red.departAt, teamOf(ended, 'red').departAt);
  assert.equal(red.hold, undefined);
  const dests = of(out.effects, 'teleport').find((e) => e.players.includes('h'));
  assert.deepEqual(dests?.pos, matOf(out.state, 4));
  assert.equal(reduce(out.state, { type: 'tick' }).state.phase, 'running');
});

test('resume mid-leg: each racer goes back where they stood and is held for 10 seconds', () => {
  const state = pitRace();
  const ended = go(state, {
    type: 'endDay',
    by: 'h',
    positions: [{ id: 'h', pos: { x: 9, y: 70, z: 9 } }],
  }).state;
  const out = go(ended, { type: 'resumeDay', by: 'h' });
  const red = teamOf(out.state, 'red');
  assert.equal(red.hold, 'resume');
  assert.equal(red.departAt, ended.clock + RACE.resumeTicks);
  const tp = of(out.effects, 'teleport');
  assert.deepEqual(tp.find((e) => e.players[0] === 'h')?.pos, { x: 9, y: 70, z: 9 });
  assert.ok(locksOf(out.effects, true).includes('h'));
  // After 10 s the hold is released like any departure.
  const later = ticks(out.state, RACE.resumeTicks);
  assert.equal(teamOf(later, 'red').departAt, undefined);
  assert.equal(teamOf(later, 'red').hold, undefined);
});

test('a day that ends again during the countdown resumes from the saved positions', () => {
  const state = pitRace();
  const first = go(go(state, { type: 'endDay', by: 'h', positions: [] }).state, { type: 'resumeDay', by: 'h' }).state;
  const again = go(first, {
    type: 'endDay', by: 'h', positions: [{ id: 'b', pos: { x: 3, y: 70, z: 3 } }],
  }).state;
  const out = go(again, { type: 'resumeDay', by: 'h' });
  assert.deepEqual(
    of(out.effects, 'teleport').find((e) => e.players[0] === 'b')?.pos,
    { x: 3, y: 70, z: 3 },
  );
});

test('a team serving a penalty on the mat or already checked in gets no countdown', () => {
  const state = pitRace();
  const mat: State = {
    ...state,
    teams: state.teams.map((t) => (t.id === 'red' ? { ...t, arrivedAt: state.clock, penaltyOwed: 600 } : t)),
  };
  const ended = go(mat, { type: 'endDay', by: 'h', positions: [] }).state;
  const out = go(ended, { type: 'resumeDay', by: 'h' });
  assert.equal(teamOf(out.state, 'red').departAt, undefined);
  assert.ok(locksOf(out.effects, true).includes('h'));
  assert.equal(teamOf(out.state, 'blue').hold, 'resume');
});

test('the reminder reaches the host once a day, by the race clock only', () => {
  const state = pitRace();
  const limit = state.settings.minutesPerDay * 60 * 20;
  const early: State = { ...state, clock: state.dayStartClock + limit - 2 };
  assert.equal(of(reduce(early, { type: 'tick' }).effects, 'notify').length, 0);
  const due = reduce(early, { type: 'tick' });
  const [hit] = of(reduce(due.state, { type: 'tick' }).effects, 'notify');
  assert.equal(hit?.to, 'h');
  assert.equal(hit?.code, 'dayMinutes');
  const paused = go(early, { type: 'pauseRace', by: 'h' }).state;
  assert.equal(ticks(paused, 50).remindedDay, undefined);
  const after = ticks(early, 4);
  assert.equal(after.remindedDay, 1);
  assert.equal(of(reduce(after, { type: 'tick' }).effects, 'notify').length, 0);
});
