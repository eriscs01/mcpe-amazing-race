// Ending a leg (spec §8.5): grace, the last team (eliminated or given a Speed Bump), rest,
// staggered departures, the host's End leg, and the final leg's winner.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LogCapture } from './helpers/logCapture.js';
import { MapBag } from './helpers/mapBag.js';
import {
  broadcasts, matOf, onMat, pitRace, stopOf,
} from './helpers/race.js';
import { RACE } from '../src/core/config.js';
import { saveState } from '../src/core/persist.js';
import { reduce } from '../src/core/race/engine.js';
import { lockedPlayers } from '../src/core/race/locks.js';
import { Session } from '../src/core/session.js';

import type { Action, Effect, State } from '../src/core/types.js';

const of = <K extends Effect['kind']>(effects: Effect[], kind: K) => effects.filter(
  (e): e is Extract<Effect, { kind: K }> => e.kind === kind,
);
const teamOf = (state: State, id: string) => {
  const found = state.teams.find((t) => t.id === id);
  if (!found) throw new Error(`no team ${id}`);
  return found;
};

/** Runs `n` ticks, collecting every effect on the way. */
function run(from: State, n: number, ...first: Action[]): { state: State; effects: Effect[] } {
  let state = from;
  const effects: Effect[] = [];
  first.forEach((a) => {
    const out = reduce(state, a);
    state = out.state;
    effects.push(...out.effects);
  });
  for (let i = 0; i < n; i += 1) {
    const out = reduce(state, { type: 'tick' });
    state = out.state;
    effects.push(...out.effects);
  }
  return { state, effects };
}
const arrive = (state: State, ids: string[], leg = 4) => onMat(state, leg, ids);

/** Red, then blue check in; green has not arrived. One tick has settled it into grace. */
function graceRace(eliminating = true): State {
  const state = pitRace(eliminating);
  return run(state, 1, arrive(state, ['h', 'b']), arrive(state, ['c', 'd'])).state;
}

test('when exactly one team is left, it gets a 60 second grace period', () => {
  const state = pitRace();
  const out = run(state, 1, arrive(state, ['h', 'b']), arrive(state, ['c', 'd']));
  assert.equal(out.state.leg.phase, 'grace');
  assert.equal(out.state.leg.graceEnd, out.state.clock + RACE.graceTicks);
  assert.ok(broadcasts(out.effects).some((t) => /Team Green .*60 seconds/.test(t)));
});

test('no grace while two teams are still out, or while the last one serves a penalty', () => {
  const state = pitRace();
  assert.equal(run(state, 5, arrive(state, ['h', 'b'])).state.leg.phase, 'racing');
  const owing = {
    ...state, teams: state.teams.map((t) => (t.id === 'green' ? { ...t, penaltyOwed: 400 } : t)),
  };
  const all = ['h', 'b', 'c', 'd', 'f', 'g'];
  const out = run(owing, 5, arrive(owing, all));
  assert.equal(out.state.leg.phase, 'racing');
  assert.equal(teamOf(out.state, 'green').status, 'racing');
});

test('the straggler checking in during grace ends the leg and is the last place', () => {
  const state = graceRace();
  const out = run(state, 3, arrive(state, ['f', 'g']));
  assert.equal(teamOf(out.state, 'green').checkIns[0]?.place, 3);
  assert.equal(teamOf(out.state, 'green').status, 'eliminated');
  assert.equal(out.state.leg.phase, 'rest');
});

test('when grace runs out the straggler is moved to the mat, placed last and eliminated', () => {
  const state = graceRace();
  const out = run(state, RACE.graceTicks);
  const green = teamOf(out.state, 'green');
  assert.equal(green.status, 'eliminated');
  assert.equal(green.checkIns[0]?.place, 3);
  const [tp] = of(out.effects, 'teleport');
  assert.deepEqual(tp?.players, ['f', 'g']);
  assert.deepEqual(tp?.pos, matOf(state, 4));
  assert.deepEqual(of(out.effects, 'spectate')[0]?.players, ['f', 'g']);
  assert.deepEqual(of(out.effects, 'takeItem').map((e) => `${e.from}:${e.item}`), [
    'f:passport', 'g:passport',
  ]);
  assert.ok(broadcasts(out.effects).includes('Team Green has been eliminated!'));
  const rows = of(out.effects, 'sidebar').at(-1)?.rows ?? [];
  assert.equal(rows.some((r) => r.name.startsWith('[OUT] ')), true);
});

test('on a leg that does not eliminate, the last team gets a Speed Bump instead', () => {
  const state = graceRace(false);
  const out = run(state, RACE.graceTicks);
  const green = teamOf(out.state, 'green');
  assert.equal(green.status, 'racing');
  assert.equal(green.speedBump, true);
  assert.equal(green.leg, 2);
  assert.equal(of(out.effects, 'spectate').length, 0);
  assert.ok(broadcasts(out.effects).some((t) => /Team Green .*Speed Bump/.test(t)));
  assert.equal(teamOf(out.state, 'red').speedBump, false);
});

test('a team whose members are all offline counts as not checked in', () => {
  const state = pitRace();
  const out = run(state, 1, arrive(state, ['h', 'b']), arrive(state, ['c', 'd']));
  assert.equal(out.state.leg.phase, 'grace', 'green has nobody online, yet is the straggler');
});

test('the leg ends at once when every team has checked in', () => {
  const state = pitRace(false);
  const out = run(state, 2, arrive(state, ['h', 'b', 'c', 'd', 'f', 'g']));
  assert.equal(out.state.leg.phase, 'rest');
  assert.equal(out.state.leg.n, 2);
  assert.equal(teamOf(out.state, 'green').speedBump, true, 'the last to check in');
});

test('rest lasts 20 seconds, heals and feeds, and swaps the beams', () => {
  const state = pitRace(false);
  const lit = { ...state, stops: state.stops.map((s) => ({ ...s, lit: s.leg === 1 })) };
  const out = run(lit, 2, arrive(lit, ['h', 'b', 'c', 'd', 'f', 'g']));
  assert.equal(out.state.leg.restEnd, out.state.clock - 1 + RACE.restTicks);
  assert.deepEqual(of(out.effects, 'restore')[0]?.players.sort(), ['b', 'c', 'd', 'f', 'g', 'h']);
  const [light] = of(out.effects, 'lightStops');
  const byId = Object.fromEntries((light?.sites ?? []).map((s) => [s.id, s.lit]));
  assert.equal(byId[4], false, 'the finished leg is unlit');
  assert.equal(byId[5], true, 'the next leg is lit');
  assert.deepEqual(out.state.stops.filter((s) => s.lit).map((s) => s.leg), [2, 2, 2, 2]);
});

test('departures follow check-in order, the gap behind the winner capped at 45 s', () => {
  const state = pitRace(false);
  const first = run(state, 0, arrive(state, ['h', 'b'])).state;
  const second = run(run(first, 100).state, 0, arrive(first, ['c', 'd'])).state;
  const third = run(run(second, 1000).state, 0, arrive(second, ['f', 'g'])).state;
  const done = run(third, 1).state;
  const restEnd = done.leg.restEnd ?? 0;
  assert.equal(teamOf(done, 'red').departAt, restEnd);
  assert.equal(teamOf(done, 'blue').departAt, restEnd + 100);
  assert.equal(teamOf(done, 'green').departAt, restEnd + RACE.departCapTicks);
});

test('everyone is movement-locked through the rest and until their own departure', () => {
  const state = pitRace(false);
  const done = run(state, 1, arrive(state, ['h', 'b', 'c', 'd', 'f', 'g'])).state;
  assert.deepEqual(lockedPlayers(done).sort(), ['b', 'c', 'd', 'f', 'g', 'h']);
  assert.deepEqual(lockedPlayers(state), []);
});

test('rest then departing: each team is released on its own time and may play at once', () => {
  const state = pitRace(false);
  const first = run(state, 0, arrive(state, ['h', 'b'])).state;
  const second = run(run(first, 100).state, 0, arrive(first, ['c', 'd', 'f', 'g'])).state;
  const ended = run(second, 1).state;
  const restEnd = ended.leg.restEnd ?? 0;
  const atRestEnd = run(ended, restEnd - ended.clock);
  assert.equal(atRestEnd.state.leg.phase, 'departing');
  assert.ok(broadcasts(atRestEnd.effects).includes('Leg 2 begins.'));
  assert.equal(of(atRestEnd.effects, 'title').filter((t) => t.chat).length, 3, 'one clue per team');
  assert.equal(teamOf(atRestEnd.state, 'red').departAt, undefined, 'the winner leaves at restEnd');
  assert.deepEqual(of(atRestEnd.effects, 'lockMovement').at(-1)?.players, ['h', 'b']);
  assert.deepEqual(lockedPlayers(atRestEnd.state).sort(), ['c', 'd', 'f', 'g']);
  const box = { ...stopOf(state, 5).pos, y: stopOf(state, 5).pos.y + 1 };
  const members = (ids: string[]) => ids.map((id) => ({ id, pos: box }));
  const early = reduce(atRestEnd.state, {
    type: 'interactClue', player: 'h', pos: box, members: members(['h', 'b']),
  });
  assert.equal(early.refusal, undefined, 'the released team plays while the others wait');
  const waiting = reduce(atRestEnd.state, {
    type: 'interactClue', player: 'c', pos: box, members: members(['c', 'd']),
  });
  assert.equal(waiting.refusal, 'notRacing');
  const all = run(atRestEnd.state, 100);
  assert.equal(all.state.leg.phase, 'racing');
  assert.deepEqual(lockedPlayers(all.state), []);
});

test('the next leg starts every surviving team at its first stop, racing', () => {
  const state = pitRace(true);
  const out = run(state, RACE.restTicks + 2, arrive(state, ['h', 'b', 'c', 'd', 'f', 'g']));
  assert.deepEqual(out.state.teams.map((t) => [t.id, t.status, t.leg, t.step]), [
    ['red', 'racing', 2, 0], ['blue', 'racing', 2, 0], ['green', 'eliminated', 1, 4],
  ]);
});

test('the host ends the leg with one team still out: same as grace running out', () => {
  const { state } = run(pitRace(), 1, arrive(pitRace(), ['h', 'b']), arrive(pitRace(), ['c', 'd']));
  assert.equal(reduce(state, { type: 'endLeg', by: 'b' }).refusal, 'notHost');
  const out = reduce(state, { type: 'endLeg', by: 'h' });
  assert.equal(teamOf(out.state, 'green').status, 'eliminated');
  assert.equal(out.state.leg.phase, 'rest');
});

test('the host cannot end a leg while two teams are still out', () => {
  const { state } = run(pitRace(), 1, arrive(pitRace(), ['h', 'b']));
  const out = reduce(state, { type: 'endLeg', by: 'h' });
  assert.equal(out.refusal, 'teamsStillOut');
  assert.equal(out.state, state);
});

test('the host cannot end a leg outside a leg or on the final leg', () => {
  const state = pitRace();
  const paused = { ...state, phase: 'paused' as const };
  assert.equal(reduce(paused, { type: 'endLeg', by: 'h' }).refusal, 'badPhase');
  const final = { ...state, leg: { n: 2, phase: 'racing' as const } };
  assert.equal(reduce(final, { type: 'endLeg', by: 'h' }).refusal, 'finalLeg');
  const resting = { ...state, leg: { n: 2, phase: 'rest' as const, restEnd: 99 } };
  assert.equal(reduce(resting, { type: 'endLeg', by: 'h' }).refusal, 'notRacing');
});

test('ending the leg checks in a team serving a penalty; the rest joins its departure', () => {
  const base = pitRace(false);
  const owing = {
    ...base, teams: base.teams.map((t) => (t.id === 'blue' ? { ...t, penaltyOwed: 600 } : t)),
  };
  const out = run(owing, 100, arrive(owing, ['h', 'b']), arrive(owing, ['c', 'd']));
  const ended = reduce(out.state, { type: 'endLeg', by: 'h' }).state;
  const blue = teamOf(ended, 'blue');
  assert.equal(blue.leg, 2, 'on to the next leg');
  assert.equal(blue.checkIns[0]?.place, 2);
  assert.equal(blue.penaltyOwed, 0);
  const restEnd = ended.leg.restEnd ?? 0;
  const owed = 600 - 100;
  assert.equal(blue.departAt, restEnd + Math.min(out.state.clock - 0, RACE.departCapTicks) + owed);
  assert.equal(teamOf(ended, 'green').speedBump, true);
});

test('the final leg: the first in wins, the others may still check in, then it ends', () => {
  const state = { ...pitRace(), leg: { n: 2, phase: 'racing' as const } };
  const onLeg2 = {
    ...state, teams: state.teams.map((t) => ({ ...t, leg: 2, step: 3 })),
  };
  const first = run(onLeg2, 0, onMat(onLeg2, 8, ['c', 'd']));
  assert.equal(first.state.winner, 'blue');
  assert.ok(broadcasts(first.effects).includes('Team Blue wins the Amazing Race!'));
  assert.equal(first.state.phase, 'running');
  assert.equal(first.state.leg.phase, 'racing', 'no grace and no elimination on the final leg');
  const rest = run(first.state, 5, onMat(onLeg2, 8, ['h', 'b']), onMat(onLeg2, 8, ['f', 'g']));
  assert.equal(rest.state.phase, 'finished');
  assert.deepEqual(rest.state.teams.map((t) => t.status), ['checkedIn', 'checkedIn', 'checkedIn']);
});

test('the final leg ends 60 seconds after the winner even if teams are still out', () => {
  const state = pitRace();
  const onLeg2 = {
    ...state,
    leg: { n: 2, phase: 'racing' as const },
    teams: state.teams.map((t) => ({ ...t, leg: 2, step: 3 })),
  };
  const first = run(onLeg2, 0, onMat(onLeg2, 8, ['c', 'd'])).state;
  const near = run(first, RACE.finishWindowTicks - 1);
  assert.equal(near.state.phase, 'running');
  const end = run(near.state, 1);
  assert.equal(end.state.phase, 'finished');
  assert.deepEqual(of(end.effects, 'lockMovement').at(-1)?.locked, false);
  assert.equal(teamOf(end.state, 'red').status, 'racing');
});

test('check-in and leg end are logged by the clock, team and leg', () => {
  const state = graceRace();
  const expiring = { ...state, leg: { n: 1, phase: 'grace' as const, graceEnd: state.clock } };
  const out = reduce(expiring, { type: 'tick' });
  const events = (out.logs ?? []).map((l) => l.event);
  assert.ok(events.includes('legEnded'));
  assert.ok(events.includes('teamEliminated'));
});

test('through the session: an unchanged position report is not saved or logged', () => {
  const bag = new MapBag();
  const capture = new LogCapture();
  saveState(bag, pitRace());
  const executed: Effect[] = [];
  const session = new Session({
    bag, sink: capture.sink, execute: (e) => executed.push(...e), newSeed: () => 1,
  });
  session.load();
  session.dispatch({ type: 'setPhase', to: 'running', by: 'h' });
  const base = session.state;
  const { writes } = bag;
  const lines = capture.lines.length;
  const nobody = { type: 'racerPositions' as const, players: [] };
  for (let i = 0; i < 5; i += 1) session.dispatch(nobody);
  assert.equal(session.state, base);
  assert.equal(bag.writes, writes, 'no save for a report that changed nothing');
  assert.equal(capture.lines.length, lines, 'and no log line');
  session.dispatch(onMat(pitRace(), 4, ['h', 'b']));
  assert.ok(bag.writes > writes);
  assert.equal(capture.find('checkedIn').length, 1);
  assert.ok(broadcasts(executed).includes('Team Red — you are team number 1!'));
  assert.deepEqual(
    session.state?.teams.find((t) => t.id === 'red')?.checkIns,
    [{ leg: 1, clock: session.state?.clock, place: 1 }],
  );
});
