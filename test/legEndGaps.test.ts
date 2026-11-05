// Gaps left by the Pit Stop and leg-end tests (#47): End leg during the departures, a forced end
// with a penalty on the mat, a pause during the mat countdown, a reload with a racer on the mat.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LogCapture } from './helpers/logCapture.js';
import { MapBag } from './helpers/mapBag.js';
import { onMat, pitRace } from './helpers/race.js';
import { RACE } from '../src/core/config.js';
import { saveState } from '../src/core/persist.js';
import { reduce } from '../src/core/race/engine.js';
import { Session } from '../src/core/session.js';

import type {
  Action, Effect, State, Team,
} from '../src/core/types.js';

const teamOf = (state: State, id: string): Team => {
  const found = state.teams.find((t) => t.id === id);
  if (!found) throw new Error(`no team ${id}`);
  return found;
};
const go = (state: State, action: Action) => reduce(state, action);
const ticks = (from: State, n: number): State => Array.from({ length: n })
  .reduce<State>((s) => reduce(s, { type: 'tick' }).state, from);
const patch = (state: State, id: string, change: Partial<Team>): State => ({
  ...state, teams: state.teams.map((t) => (t.id === id ? { ...t, ...change } : t)),
});

const place = (state: State, id: string): number | undefined => teamOf(state, id)
  .checkIns.find((c) => c.leg === 1)?.place;
/** Red standing on the mat of leg 1's Pit Stop with `owed` ticks of penalty to serve. */
const owing = (owed: number): State => {
  const state = patch(pitRace(true), 'red', { penaltyOwed: owed });
  return go(state, onMat(state, 4, ['h', 'b'])).state;
};

test('End leg while the teams are still departing ranks the stragglers last', () => {
  const state: State = { ...pitRace(false), leg: { n: 1, phase: 'departing' } };
  const waiting = patch(state, 'green', { step: 0, departAt: state.clock + 100 });
  const out = go(waiting, { type: 'endLeg', by: 'h' });
  assert.equal(out.refusal, undefined);
  assert.deepEqual(['red', 'blue', 'green'].map((id) => place(out.state, id)), [1, 2, 3]);
  assert.equal(teamOf(out.state, 'green').speedBump, true, 'last place gets the Speed Bump');
  assert.equal(out.state.leg.phase, 'rest');
  assert.ok(out.state.teams.every((t) => t.departAt === out.state.leg.restEnd), 'rest departures');
});

test('a forced end eliminates the last team even while it served a penalty on the mat', () => {
  const state = pitRace(true);
  const checked = [onMat(state, 4, ['h', 'b']), onMat(state, 4, ['c', 'd'])]
    .reduce<State>((s, a) => go(s, a).state, state);
  const serving = patch(checked, 'green', { arrivedAt: checked.clock, penaltyOwed: 600 });
  const out = go(serving, { type: 'endLeg', by: 'h' });
  assert.equal(teamOf(out.state, 'green').status, 'eliminated');
  assert.equal(place(out.state, 'green'), 3);
  assert.deepEqual(['red', 'blue'].map((id) => teamOf(out.state, id).status), ['racing', 'racing']);
  assert.ok(out.effects.some((e) => e.kind === 'spectate' && e.players.includes('f')));
});

test('a pause stops the penalty wait on the mat; unpausing lets it run out', () => {
  const arrived = owing(RACE.countdownTicks);
  assert.equal(teamOf(arrived, 'red').arrivedAt, arrived.clock);
  const paused = go(arrived, { type: 'pauseRace', by: 'h' }).state;
  const waited = ticks(paused, RACE.countdownTicks * 2);
  assert.equal(teamOf(waited, 'red').status, 'racing', 'the race clock stood still');
  const back = go(waited, { type: 'unpauseRace', by: 'h' }).state;
  assert.equal(teamOf(ticks(back, RACE.countdownTicks), 'red').status, 'checkedIn');
});

test('a day that ends during the penalty wait stops it; resuming the day lets it run out', () => {
  const arrived = owing(RACE.countdownTicks);
  const ended = go(arrived, { type: 'endDay', by: 'h', positions: [] }).state;
  const waited = ticks(ended, RACE.countdownTicks * 2);
  assert.equal(teamOf(waited, 'red').status, 'racing', 'the race clock stood still');
  const back = go(waited, { type: 'resumeDay', by: 'h' }).state;
  assert.equal(teamOf(ticks(back, RACE.countdownTicks), 'red').status, 'checkedIn');
});

test('a reload re-locks a team that was serving a penalty on its mat', () => {
  const bag = new MapBag();
  saveState(bag, { ...owing(RACE.countdownTicks), hostId: 'h' });
  const seen: Effect[] = [];
  const session: Session = new Session({
    bag, sink: new LogCapture().sink, newSeed: () => 1, execute: (e) => seen.push(...e),
  });
  session.load();
  const locked = seen.flatMap((e) => (e.kind === 'lockMovement' && e.locked ? e.players : []));
  assert.ok(locked.includes('h') && locked.includes('b'), 'the team on the mat stays held');
  // The reload paused the race; unpausing frees everyone but the team still serving its penalty.
  seen.length = 0;
  session.dispatch({ type: 'unpauseRace', by: 'h' });
  const freed = seen.flatMap((e) => (e.kind === 'lockMovement' && !e.locked ? e.players : []));
  assert.ok(['c', 'd', 'f', 'g'].every((id) => freed.includes(id)));
  assert.ok(!freed.includes('h') && !freed.includes('b'), 'still held on the mat');
});
