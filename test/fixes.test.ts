// The host's Team fixes and End race (spec §4, §12), and the husks they leave (#53).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { onMat, pitRace } from './helpers/race.js';
import { HOUR } from '../src/core/config.js';
import { reduce } from '../src/core/race/engine.js';

import type {
  Action, Effect, State, Team,
} from '../src/core/types.js';

const of = <K extends Effect['kind']>(effects: Effect[], kind: K) => effects.filter(
  (e): e is Extract<Effect, { kind: K }> => e.kind === kind,
);
const team = (state: State, id: string): Team => {
  const found = state.teams.find((t) => t.id === id);
  if (!found) throw new Error(`no team ${id}`);
  return found;
};
type Fix = Extract<Action, { type: 'teamFix' }>['fix'];
const fix = (state: State, id: string, f: Fix, by = 'e') => reduce({ ...state, hostId: 'e' }, {
  type: 'teamFix', by, team: id, fix: f,
});

test('Add penalty: race minutes become owed ticks, for the host and a team still in', () => {
  const state = pitRace();
  const out = fix(state, 'blue', { kind: 'penalty', minutes: 30 });
  assert.equal(team(out.state, 'blue').penaltyOwed, HOUR / 2);
  assert.equal(fix(state, 'blue', { kind: 'penalty', minutes: 30 }, 'c').refusal, 'notHost');
  assert.equal(fix(state, 'blue', { kind: 'penalty', minutes: 0 }).refusal, 'noMinutes');
  assert.equal(fix(state, 'nope', { kind: 'penalty', minutes: 5 }).refusal, 'noTeam');
  const gone = fix(state, 'blue', { kind: 'eliminate' }).state;
  assert.equal(fix(gone, 'blue', { kind: 'penalty', minutes: 5 }).refusal, 'eliminated');
});

test('Skip current step advances the team, but not past a Pit Stop', () => {
  const state = pitRace();
  const early: State = {
    ...state, teams: state.teams.map((t) => (t.id === 'blue' ? { ...t, step: 1 } : t)),
  };
  const out = fix(early, 'blue', { kind: 'skip' });
  assert.equal(team(out.state, 'blue').step, 2);
  assert.ok(of(out.effects, 'title').length > 0);
  // step 3 is the leg's Pit Stop (stop 4).
  assert.equal(fix(state, 'blue', { kind: 'skip' }).refusal, 'pitStep');
});

test('Teleport me to team: the host is moved; a racing host or an empty team is refused', () => {
  const state = pitRace();
  const at = { x: 4, y: 70, z: 4 };
  const out = fix(state, 'blue', { kind: 'goto', at });
  assert.deepEqual(of(out.effects, 'teleport'), [{ kind: 'teleport', players: ['e'], pos: at }]);
  assert.equal(fix(state, 'blue', { kind: 'goto' }).refusal, 'nobodyOnline');
  assert.equal(fix(state, 'blue', { kind: 'goto', at }, 'h').refusal, 'notHost');
  const racing: State = { ...state, hostId: 'h' };
  const hostRaces = reduce(racing, {
    type: 'teamFix', by: 'h', team: 'blue', fix: { kind: 'goto', at },
  });
  assert.equal(hostRaces.refusal, 'hostRaces');
  // A host who has checked in is still in the race: the same refusal.
  const checkedIn: State = {
    ...racing,
    teams: racing.teams.map((t) => (t.members.includes('h') ? { ...t, status: 'checkedIn' } : t)),
  };
  const mat = reduce(checkedIn, {
    type: 'teamFix', by: 'h', team: 'blue', fix: { kind: 'goto', at },
  });
  assert.equal(mat.refusal, 'hostRaces');
});

test('Eliminate: Spectator, no Passport, unlocked, husks removed, never the last team', () => {
  const state = pitRace();
  const held: State = {
    ...state,
    teams: state.teams.map((t) => (t.id === 'blue'
      ? {
        ...t, departAt: 5, arrivedAt: 1, performer: 'c',
      } : t)),
  };
  const out = fix(held, 'blue', { kind: 'eliminate' });
  const blue = team(out.state, 'blue');
  assert.equal(blue.status, 'eliminated');
  assert.equal(blue.departAt, undefined);
  assert.equal(blue.performer, undefined);
  assert.deepEqual(of(out.effects, 'spectate')[0]?.players, ['c', 'd']);
  assert.deepEqual(of(out.effects, 'clearHusks'), [{ kind: 'clearHusks', team: 'blue' }]);
  assert.equal(of(out.effects, 'takeItem').length, 2);
  const two = fix(fix(state, 'blue', { kind: 'eliminate' }).state, 'green', { kind: 'eliminate' });
  assert.equal(two.refusal, undefined);
  assert.equal(fix(two.state, 'red', { kind: 'eliminate' }).refusal, 'lastTeam');
});

test('eliminating the last team still out does not also eliminate the last place', () => {
  const state = pitRace(true);
  const checked = [onMat(state, 4, ['h', 'b']), onMat(state, 4, ['c', 'd'])]
    .reduce<State>((s, a) => reduce(s, a).state, state);
  const out = fix(checked, 'green', { kind: 'eliminate' }).state;
  const after = reduce(reduce(out, { type: 'tick' }).state, { type: 'tick' }).state;
  assert.equal(after.teams.filter((t) => t.status === 'eliminated').length, 1);
  assert.equal(after.leg.n, 2);
});

test('a leg that ends clears the husks of a Hunt left half way, and of an eliminated team', () => {
  const state = pitRace(true);
  const hunt: State = {
    ...state,
    stops: state.stops.map((s) => (s.id === 2
      ? { ...s, task: { type: 'detour' as const, options: ['hunt', 'aim'] as never } } : s)),
    teams: state.teams.map((t) => (t.id === 'green'
      ? { ...t, step: 1, task: { stopId: 2, option: 'A' as const } } : t)),
  };
  const checked = [onMat(hunt, 4, ['h', 'b']), onMat(hunt, 4, ['c', 'd'])]
    .reduce<State>((s, a) => reduce(s, a).state, hunt);
  const out = reduce(checked, { type: 'endLeg', by: 'h' });
  const husks = of(out.effects, 'clearHusks').map((e) => e.team);
  assert.ok(husks.includes('green'));
});

test('End race restores the world, releases everyone and is done once', () => {
  const base = pitRace();
  const snapshot = { rules: { keepInventory: false }, time: 5 };
  const state: State = { ...base, hostId: 'e', snapshot };
  const out = reduce(state, { type: 'endRace', by: 'e', online: [] });
  assert.equal(out.state.phase, 'finished');
  assert.equal(out.state.ended, true);
  assert.deepEqual(of(out.effects, 'restoreWorld'), [
    { kind: 'restoreWorld', snapshot: { rules: { keepInventory: false }, time: 5 } },
  ]);
  assert.deepEqual(of(out.effects, 'clearHusks'), [{ kind: 'clearHusks' }]);
  assert.equal(of(out.effects, 'clearSidebar').length, 1);
  const everyone = ['b', 'c', 'd', 'f', 'g', 'h'];
  assert.deepEqual(of(out.effects, 'resetPlayers')[0]?.players.sort(), everyone);
  assert.equal(of(out.effects, 'takeItem').length, 6);
  assert.equal(reduce(out.state, { type: 'endRace', by: 'e', online: [] }).refusal, 'alreadyEnded');
  assert.equal(reduce(state, { type: 'endRace', by: 'h', online: [] }).refusal, 'notHost');
  const ready: State = { ...state, phase: 'ready' };
  assert.equal(reduce(ready, { type: 'endRace', by: 'e', online: [] }).refusal, 'badPhase');
});

test('End race works on a final leg nobody finished, and from a finished race', () => {
  const state: State = { ...pitRace(), hostId: 'e', phase: 'paused' };
  assert.equal(reduce(state, { type: 'endRace', by: 'e', online: [] }).refusal, undefined);
  const done: State = { ...state, phase: 'finished' };
  assert.equal(reduce(done, { type: 'endRace', by: 'e', online: [] }).state.ended, true);
});

test('the host\'s elimination still counts for the leg after the grace period', () => {
  const state = pitRace(true);
  const red = reduce(state, onMat(state, 4, ['h', 'b'])).state;
  const out = fix(red, 'green', { kind: 'eliminate' }).state;
  let now = out;
  for (let i = 0; i < 1300; i += 1) now = reduce(now, { type: 'tick' }).state;
  assert.equal(now.teams.filter((t) => t.status === 'eliminated').length, 1);
  assert.equal(now.leg.n, 2);
});
