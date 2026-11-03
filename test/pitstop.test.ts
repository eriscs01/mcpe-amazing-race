// Pit Stop check-in (spec §8.4): arrival on the mat, the penalty countdown with its lock,
// placement by completed check-in, and the reward for the leg winner.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  broadcasts, matOf, onMat, pitRace, stopOf,
} from './helpers/race.js';
import { matCentre } from '../src/core/clue.js';
import { RACE } from '../src/core/config.js';
import { reduce } from '../src/core/race/engine.js';

import type { Action, Effect, State } from '../src/core/types.js';

const of = <K extends Effect['kind']>(effects: Effect[], kind: K) => effects.filter(
  (e): e is Extract<Effect, { kind: K }> => e.kind === kind,
);
const teamOf = (state: State, id: string) => {
  const found = state.teams.find((t) => t.id === id);
  if (!found) throw new Error(`no team ${id}`);
  return found;
};
const owing = (state: State, id: string, ticks: number): State => ({
  ...state, teams: state.teams.map((t) => (t.id === id ? { ...t, penaltyOwed: ticks } : t)),
});
const ticks = (state: State, n: number): State => Array.from({ length: n })
  .reduce<State>((s) => reduce(s, { type: 'tick' }).state, state);

test('the mat centre is the stop six blocks south, at a block centre', () => {
  const state = pitRace();
  assert.deepEqual(matCentre(stopOf(state, 4)), { x: 400.5, y: 71, z: -33.5 });
});

test('a team whose online members all stand on the mat checks in at once', () => {
  const state = pitRace();
  const out = reduce(state, onMat(state, 4, ['h', 'b']));
  const red = teamOf(out.state, 'red');
  assert.equal(red.status, 'checkedIn');
  assert.deepEqual(red.checkIns, [{ leg: 1, clock: 0, place: 1 }]);
  assert.equal(red.step, 4, 'the Pit Stop counts as cleared');
  assert.equal(red.lastClearedStop, 4);
  assert.equal(red.arrivedAt, undefined);
  assert.deepEqual(broadcasts(out.effects), ['Team Red — you are team number 1!']);
  assert.ok(of(out.effects, 'sidebar').length > 0);
});

test('the leg winner alone gets five levels and a firework at the mat', () => {
  const state = pitRace();
  const first = reduce(state, onMat(state, 4, ['h', 'b']));
  const [reward] = of(first.effects, 'reward');
  assert.deepEqual(reward?.to, ['h', 'b']);
  assert.equal(reward?.levels, RACE.winnerLevels);
  assert.deepEqual(reward?.at, matOf(state, 4));
  const second = reduce(first.state, onMat(state, 4, ['c', 'd']));
  assert.equal(of(second.effects, 'reward').length, 0);
  assert.equal(teamOf(second.state, 'blue').checkIns[0]?.place, 2);
});

test('a teammate off the mat, or in another dimension, holds the team back', () => {
  const state = pitRace();
  const away = { id: 'b', pos: { ...matOf(state, 4), x: matOf(state, 4).x + 3 } };
  const near = { id: 'h', pos: matOf(state, 4) };
  const partial = reduce(state, { type: 'racerPositions', players: [near, away] });
  assert.equal(partial.state, state, 'nothing changed, so the same state');
  const other = reduce(state, { type: 'racerPositions', players: [near, { id: 'b' }] });
  assert.equal(other.state, state);
});

test('an offline member does not hold the team back; nobody online never arrives', () => {
  const state = pitRace();
  const hana = { id: 'h', pos: matOf(state, 4) };
  const solo = reduce(state, { type: 'racerPositions', players: [hana] });
  assert.equal(teamOf(solo.state, 'red').status, 'checkedIn');
  const nobody = reduce(state, { type: 'racerPositions', players: [] });
  assert.equal(nobody.state, state);
});

test('arrival is horizontal and within two blocks of the centre', () => {
  const state = pitRace();
  const at = (dx: number, dy = 0) => reduce(state, {
    type: 'racerPositions',
    players: ['h', 'b'].map((id) => ({
      id, pos: { x: matOf(state, 4).x + dx, y: matOf(state, 4).y + dy, z: matOf(state, 4).z },
    })),
  }).state;
  assert.equal(teamOf(at(RACE.matRadius), 'red').status, 'checkedIn');
  assert.equal(teamOf(at(RACE.matRadius + 0.1), 'red').status, 'racing');
  assert.equal(teamOf(at(0, 30), 'red').status, 'checkedIn', 'height is ignored');
});

test('only a team heading for a Pit Stop or Finish can check in, and only while racing', () => {
  const state = pitRace();
  const early = {
    ...state, teams: state.teams.map((t) => (t.id === 'red' ? { ...t, step: 2 } : t)),
  };
  assert.equal(reduce(early, onMat(state, 4, ['h', 'b'])).state, early);
  const paused = { ...state, phase: 'paused' as const };
  assert.equal(reduce(paused, onMat(state, 4, ['h', 'b'])).state, paused);
  const leaving = {
    ...state, teams: state.teams.map((t) => (t.id === 'red' ? { ...t, departAt: 99 } : t)),
  };
  assert.equal(reduce(leaving, onMat(state, 4, ['h', 'b'])).state, leaving);
});

test('same-tick arrivals are placed in team order, and a repeated report changes nothing', () => {
  const state = pitRace();
  const both = reduce(state, onMat(state, 4, ['h', 'b', 'c', 'd']));
  assert.equal(teamOf(both.state, 'red').checkIns[0]?.place, 1);
  assert.equal(teamOf(both.state, 'blue').checkIns[0]?.place, 2);
  assert.equal(reduce(both.state, onMat(state, 4, ['h', 'b', 'c', 'd'])).state, both.state);
});

test('owing a penalty locks the team on the mat until it is served', () => {
  const state = owing(pitRace(), 'red', 100);
  const out = reduce(state, onMat(state, 4, ['h', 'b']));
  const red = teamOf(out.state, 'red');
  assert.equal(red.status, 'racing');
  assert.equal(red.arrivedAt, 0);
  assert.deepEqual(of(out.effects, 'lockMovement'), [
    { kind: 'lockMovement', players: ['h', 'b'], locked: true },
  ]);
  const early = ticks(out.state, 99);
  assert.equal(teamOf(early, 'red').status, 'racing');
  const done = reduce(early, { type: 'tick' });
  assert.equal(teamOf(done.state, 'red').status, 'checkedIn');
  assert.equal(teamOf(done.state, 'red').penaltyOwed, 0);
  assert.deepEqual(of(done.effects, 'lockMovement'), [
    { kind: 'lockMovement', players: ['h', 'b'], locked: false },
  ]);
  assert.deepEqual(broadcasts(done.effects), ['Team Red — you are team number 1!']);
});

test('a team that arrives during another\'s countdown is placed ahead of it', () => {
  const state = owing(pitRace(), 'red', 100);
  const waiting = reduce(state, onMat(state, 4, ['h', 'b'])).state;
  const later = ticks(waiting, 10);
  const blue = reduce(later, onMat(state, 4, ['c', 'd']));
  assert.equal(teamOf(blue.state, 'blue').checkIns[0]?.place, 1);
  const red = ticks(blue.state, 90);
  assert.equal(teamOf(red, 'red').checkIns[0]?.place, 2);
});

test('the countdown is the real clock: it keeps running only while the race does', () => {
  const state = owing(pitRace(), 'red', 100);
  const waiting = reduce(state, onMat(state, 4, ['h', 'b'])).state;
  const paused = { ...waiting, phase: 'paused' as const };
  assert.equal(ticks(paused, 500).teams[0]?.status, 'racing');
});

test('a check-in is logged with the team, leg, place and clock', () => {
  const state = pitRace();
  const out = reduce(state, onMat(state, 4, ['h', 'b']));
  const log = out.logs?.find((l) => l.event === 'checkedIn');
  assert.deepEqual(log?.fields, {
    team: 'red', leg: 1, place: 1, clock: 0,
  });
});

test('the clue box of a Pit Stop sends racers to the mat', () => {
  const state = pitRace();
  const action: Action = {
    type: 'interactClue',
    player: 'h',
    pos: { ...stopOf(state, 4).pos, y: stopOf(state, 4).pos.y + 1 },
    members: [{ id: 'h', pos: matOf(state, 4) }, { id: 'b', pos: matOf(state, 4) }],
  };
  const out = reduce(state, action);
  assert.equal(out.refusal, 'stopNotReady');
  assert.deepEqual(of(out.effects, 'notify').map((e) => e.text), ['Stand on the mat to check in.']);
});
