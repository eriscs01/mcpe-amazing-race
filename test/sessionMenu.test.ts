// The host menu rows and Status of G17, and the countdown cases a pause or a day's end meets (#47).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { onMat, pitRace } from './helpers/race.js';
import { RACE } from '../src/core/config.js';
import { hostMenu, statusMenu } from '../src/core/menu.js';
import { reduce } from '../src/core/race/engine.js';
import { lockedPlayers } from '../src/core/race/locks.js';
import { raceResumeEffects } from '../src/core/race/start.js';

import type { Phase, State } from '../src/core/types.js';

const commands = (state: State): string[] => hostMenu(state).buttons.map((b) => b.command);
const inPhase = (phase: Phase): State => ({ ...pitRace(), phase });

test('the host menu offers the session rows by phase', () => {
  assert.ok(commands(inPhase('running')).includes('pause'));
  assert.ok(commands(inPhase('running')).includes('endDay'));
  assert.ok(!commands(inPhase('running')).includes('unpause'));
  assert.ok(commands(inPhase('paused')).includes('unpause'));
  assert.ok(commands(inPhase('dayEnded')).includes('resumeDay'));
  assert.ok(!commands(inPhase('dayEnded')).includes('endDay'));
  ['running', 'paused', 'dayEnded', 'finished'].forEach((p) => {
    const list = commands(inPhase(p as Phase));
    assert.ok(list.includes('status') && list.includes('endRace'), p);
  });
  assert.ok(!commands(inPhase('ready')).includes('endRace'));
  assert.ok(!commands({ ...inPhase('finished'), ended: true }).includes('endRace'));
});

test('Status shows each team: leg, step, online members, penalty, and who is out', () => {
  const state = pitRace();
  const mixed: State = {
    ...state,
    teams: state.teams.map((t) => {
      if (t.id === 'red') return { ...t, penaltyOwed: 600 };
      return t.id === 'green' ? { ...t, status: 'eliminated' as const } : t;
    }),
  };
  const { body } = statusMenu(mixed, ['h', 'c', 'd']);
  assert.match(body, /Day 1/);
  assert.match(body, /Team Red.*leg 1, pit Place 4/);
  assert.match(body, /online 1\/2, penalty 30 s/);
  assert.match(body, /online 2\/2, penalty 0 s/);
  assert.match(body, /Team Green.*: out/);
});

test('a pause during the start countdown keeps the countdown for the race clock', () => {
  const state = pitRace();
  const counting: State = {
    ...state,
    teams: state.teams.map((t) => ({ ...t, departAt: state.clock + RACE.countdownTicks })),
  };
  const paused = reduce(counting, { type: 'pauseRace', by: 'h' }).state;
  const idle = Array.from({ length: 50 })
    .reduce<State>((s) => reduce(s, { type: 'tick' }).state, paused);
  assert.equal(idle.teams[0]?.departAt, counting.teams[0]?.departAt);
  const back = reduce(idle, { type: 'unpauseRace', by: 'h' }).state;
  assert.equal(lockedPlayers(back).length, 6);
});

test('a day that ends during the countdown keeps its locks, and the reload re-locks them', () => {
  const state = pitRace();
  const counting: State = {
    ...state,
    teams: state.teams.map((t) => ({ ...t, departAt: state.clock + RACE.countdownTicks })),
  };
  const ended = reduce(counting, { type: 'endDay', by: 'h', positions: [] }).state;
  assert.equal(lockedPlayers(ended).length, 6);
  const reload = raceResumeEffects(ended).find((e) => e.kind === 'lockMovement');
  assert.equal(reload?.kind === 'lockMovement' && reload.players.length, 6);
});

test('a reload re-locks a team serving a penalty on the mat', () => {
  const state = pitRace();
  const mat = reduce(state, onMat(state, 4, ['h', 'b'])).state;
  const owing: State = {
    ...mat,
    teams: mat.teams.map((t) => (t.id === 'red' ? {
      ...t, status: 'racing', arrivedAt: 1, penaltyOwed: 600,
    } : t)),
  };
  const effects = raceResumeEffects({ ...owing, phase: 'paused' });
  assert.ok(effects.some((e) => e.kind === 'lockMovement' && e.players.includes('h')));
  assert.deepEqual(lockedPlayers(owing).sort(), ['b', 'h']);
});

test('End leg while some teams are still departing, and with the last team on its penalty', () => {
  const state = pitRace(false);
  const departing: State = {
    ...state,
    leg: { n: 1, phase: 'departing' },
    teams: state.teams.map((t) => (t.id === 'green' ? { ...t, departAt: state.clock + 100 } : t)),
  };
  const checked = [onMat(departing, 4, ['h', 'b']), onMat(departing, 4, ['c', 'd'])]
    .reduce<State>((s, a) => reduce(s, a).state, departing);
  const out = reduce(checked, { type: 'endLeg', by: 'h' });
  assert.equal(out.refusal, undefined);
  assert.equal(out.state.leg.n, 2);
  assert.equal(out.state.teams.find((t) => t.id === 'green')?.status, 'racing');
  assert.equal(out.state.teams.find((t) => t.id === 'green')?.departAt !== undefined, true);
});
