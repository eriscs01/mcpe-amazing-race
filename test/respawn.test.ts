// A racer spawns (spec §12): a death, a rejoin, a rejoin after the race was ended.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { matOf, pitRace } from './helpers/race.js';
import { reduce } from '../src/core/race/engine.js';

import type { Action, Effect, State } from '../src/core/types.js';

const of = <K extends Effect['kind']>(effects: Effect[], kind: K) => effects.filter(
  (e): e is Extract<Effect, { kind: K }> => e.kind === kind,
);
const spawn = (player: string, initial: boolean, extra: Partial<Action> = {}): Action => ({
  type: 'playerSpawned', player, name: player.toUpperCase(), initial, hasPassport: true, ...extra,
} as Action);

/** Red has cleared stop 2 (a Detour); Ben was kitted at the start, Hana is the host. */
function race(): State {
  const state = pitRace();
  return {
    ...state,
    players: Object.fromEntries(Object.entries(state.players).map(([id, p]) => [
      id, { ...p, kitted: true },
    ])),
    teams: state.teams.map((t) => (t.id === 'red' ? { ...t, lastClearedStop: 2, step: 2 } : t)),
  };
}

test('a death sends the racer to the last cleared stop and tells the teammate', () => {
  const state = race();
  const out = reduce(state, spawn('b', false));
  const [tp] = of(out.effects, 'teleport');
  assert.deepEqual(tp?.players, ['b']);
  assert.deepEqual(tp?.pos, matOf(state, 2));
  const [note] = of(out.effects, 'title');
  assert.deepEqual(note?.to, ['h']);
  assert.match(note?.text ?? '', /B died and went back to Place 2/);
  assert.equal(out.state.teams.find((t) => t.id === 'red')?.penaltyOwed, 0);
  assert.ok(out.state.teams.find((t) => t.id === 'red')?.separationResumeAt);
});

test('a Roadblock performer keeps the role and the progress after dying', () => {
  const state = race();
  const red = state.teams.find((t) => t.id === 'red');
  const set: State = {
    ...state,
    teams: state.teams.map((t) => (t === red ? {
      ...t,
      performer: 'b',
      task: { stopId: 3, option: 'A' as const },
      progress: { '3:A': { n: 2 } },
    } : t)),
  };
  const after = reduce(set, spawn('b', false)).state.teams.find((t) => t.id === 'red');
  assert.equal(after?.performer, 'b');
  assert.deepEqual(after?.progress, { '3:A': { n: 2 } });
});

test('a death while paused or held keeps the lock', () => {
  const state = race();
  const paused = reduce(state, { type: 'pauseRace', by: 'h' }).state;
  const out = reduce(paused, spawn('b', false));
  assert.ok(of(out.effects, 'lockMovement').some((e) => e.locked && e.players.includes('b')));
  const free = reduce(state, spawn('b', false));
  assert.equal(of(free.effects, 'lockMovement').length, 0);
});

test('no teleport for a spawn outside the race, an eliminated team, or a stranger', () => {
  const state = race();
  const before: State = { ...state, phase: 'ready' };
  assert.equal(of(reduce(before, spawn('b', false)).effects, 'teleport').length, 0);
  assert.equal(of(reduce(state, spawn('e', false)).effects, 'teleport').length, 0);
  const out: State = {
    ...state, teams: state.teams.map((t) => (t.id === 'red' ? { ...t, status: 'eliminated' } : t)),
  };
  assert.equal(of(reduce(out, spawn('b', false)).effects, 'teleport').length, 0);
});

test('a rejoin goes to the nearest teammate, else to the last stop', () => {
  const state = race();
  const mates = [{ id: 'h', pos: { x: 7, y: 70, z: 7 } }];
  const near = reduce(state, spawn('b', true, { mates }));
  assert.deepEqual(of(near.effects, 'teleport')[0]?.pos, { x: 7, y: 70, z: 7 });
  const alone = reduce(state, spawn('b', true));
  assert.deepEqual(of(alone.effects, 'teleport')[0]?.pos, matOf(state, 2));
  assert.equal(of(alone.effects, 'kitRacer').length, 0);
});

test('a racer who was offline at the start gets the kit once', () => {
  const state = race();
  const late: State = {
    ...state, players: { ...state.players, b: { name: 'Ben', teamId: 'red' } },
  };
  const out = reduce(late, spawn('b', true));
  assert.deepEqual(of(out.effects, 'kitRacer'), [
    {
      kind: 'kitRacer', player: 'b', name: 'B', color: '§c',
    },
  ]);
  assert.equal(out.state.players.b?.kitted, true);
  assert.equal(of(reduce(out.state, spawn('b', true)).effects, 'kitRacer').length, 0);
});

test('a rejoin during a countdown, the mat or a pause stays locked', () => {
  const state = race();
  const held: State = {
    ...state,
    teams: state.teams.map((t) => (t.id === 'red' ? { ...t, departAt: state.clock + 50 } : t)),
  };
  assert.ok(of(reduce(held, spawn('b', true)).effects, 'lockMovement').some((e) => e.locked));
  assert.equal(of(reduce(state, spawn('b', true)).effects, 'lockMovement').length, 0);
});

test('a rejoining member of an eliminated team is a spectator without a Passport', () => {
  const state = race();
  const out: State = {
    ...state, teams: state.teams.map((t) => (t.id === 'red' ? { ...t, status: 'eliminated' } : t)),
  };
  const res = reduce(out, spawn('b', true, { hasPassport: false }));
  assert.deepEqual(of(res.effects, 'spectate'), [{ kind: 'spectate', players: ['b'] }]);
  assert.deepEqual(of(res.effects, 'takeItem').map((e) => e.item), ['passport']);
  assert.equal(of(res.effects, 'giveItem').length, 0);
});

test('a rejoin after End race releases the player', () => {
  const ended: State = { ...race(), phase: 'finished', ended: true };
  const res = reduce(ended, spawn('b', true));
  assert.deepEqual(of(res.effects, 'resetPlayers'), [{ kind: 'resetPlayers', players: ['b'] }]);
  assert.deepEqual(of(res.effects, 'takeItem').map((e) => e.item), ['passport']);
  assert.equal(of(res.effects, 'teleport').length, 0);
});

test('a late racer gets the Passport after the kit that clears the pack', () => {
  const state = race();
  const late: State = {
    ...state, players: { ...state.players, b: { name: 'Ben', teamId: 'red' } },
  };
  const kinds = reduce(late, spawn('b', true, { hasPassport: false })).effects.map((e) => e.kind);
  const lastGive = kinds.lastIndexOf('giveItem');
  assert.ok(kinds.includes('kitRacer') && lastGive > kinds.indexOf('kitRacer'));
});

test('a player released after End race is unlocked as well', () => {
  const ended: State = { ...race(), phase: 'finished', ended: true };
  const { effects } = reduce(ended, spawn('b', true));
  assert.ok(of(effects, 'lockMovement').some((e) => !e.locked && e.players.includes('b')));
});
