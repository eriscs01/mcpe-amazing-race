// Advantages (spec §8.7): the Express Pass (award, expiry, use), the U-Turn (board, targeting,
// both options) and the Speed Bump quiz at the next leg's Route Info.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  alone, legTwo, patch, team, tick, withPass,
} from './helpers/adv.js';
import {
  at, boxOf, choose, click, labels, menuTo, notes, shoot,
} from './helpers/flow.js';
import {
  broadcasts, matOf, onMat, pitRace,
} from './helpers/race.js';
import { PENALTY_HOURS } from '../src/core/config.js';
import { passportMenu } from '../src/core/menu.js';
import { deckSeed, questionAt } from '../src/core/quiz/bank.js';
import { reduce } from '../src/core/race/engine.js';
import { completeCheckIn } from '../src/core/race/pitstop.js';
import { taskProgressText } from '../src/core/race/task.js';

import type {
  Action, Effect, State, TaskChoice,
} from '../src/core/types.js';

const express: TaskChoice = { type: 'expressPass' };
const aim: TaskChoice = { type: 'option', option: 'A' };
const shootB: TaskChoice = { type: 'option', option: 'B' };
interface Logged { logs?: { event: string; fields: Record<string, unknown> }[] }
const logs = (out: Logged, event: string) => (out.logs ?? []).filter((l) => l.event === event);

// ── Express Pass: award and expiry ────────────────────────────────────────────────────────────

const fourLegs = (): State => ({
  ...pitRace(false),
  plan: {
    legs: 4, legsPerDay: 4, radius: 400, eliminationLegs: [],
  },
});

test('with only two legs no pass is given (it would end before it could be used)', () => {
  const state = pitRace(false);
  const out = reduce(state, onMat(state, 4, ['h', 'b']));
  assert.equal(team(out.state, 'red').expressPass, undefined);
});

test('the leg 1 winner is awarded an Express Pass that lasts to leg ceil(L/2)', () => {
  const state = fourLegs();
  const out = reduce(state, onMat(state, 4, ['h', 'b']));
  assert.deepEqual(team(out.state, 'red').expressPass, { expiresLeg: 2 });
  assert.equal(team(out.state, 'blue').expressPass, undefined);
  assert.ok(broadcasts(out.effects).some((t) => t.includes('Express Pass')));
  assert.equal(logs(out, 'expressAwarded').length, 1);
  const second = reduce(out.state, onMat(out.state, 4, ['c', 'd']));
  assert.equal(team(second.state, 'blue').expressPass, undefined, 'only the winner');
});

test('no Express Pass for a forced check-in, or for a winner of a later leg', () => {
  const state = fourLegs();
  const forced = completeCheckIn(state, 'red', { forced: true });
  assert.equal(team(forced.state, 'red').expressPass, undefined);
  const later: State = {
    ...state,
    leg: { n: 2, phase: 'racing' },
    teams: state.teams.map((t) => ({
      ...t, leg: 2, step: 3, status: 'racing' as const, checkIns: [],
    })),
  };
  const out = reduce(later, onMat(later, 8, ['h', 'b']));
  assert.equal(team(out.state, 'red').status, 'checkedIn');
  assert.equal(team(out.state, 'red').expressPass, undefined);
});

test('the pass is cleared when leg ceil(L/2) ends, and kept through earlier legs', () => {
  const finish = (legs: number, expiresLeg: number): State => {
    const state = { ...legTwo(3, legs, withPass(expiresLeg)), stops: legTwo().stops };
    const arrived = state.teams.map((t) => ({ ...t, step: 3 }));
    const ready = { ...state, teams: arrived };
    const there = reduce(ready, onMat(ready, 8, ['h', 'b', 'c', 'd', 'f', 'g'])).state;
    return tick(tick(there).state).state;
  };
  const four = finish(4, 2);
  assert.equal(team(four, 'red').expressPass, undefined, 'expires at the end of leg 2 of 4');
  const six = finish(6, 3);
  assert.deepEqual(team(six, 'red').expressPass, { expiresLeg: 3 }, 'leg 2 of 6 is not the end');
});

// ── Express Pass: use ─────────────────────────────────────────────────────────────────────────

test('a pass is offered at the Detour only while usable, and skips a normal Detour', () => {
  const state = legTwo(1, 4, withPass(2));
  const solo = alone(state);
  const menu = menuTo(click(solo, 'h', 6), 'h');
  assert.ok(labels(menu).includes('Use Express Pass'));
  const used = choose(solo, 'h', 6, express);
  const red = team(used.state, 'red');
  assert.equal(red.expressPass, undefined, 'consumed');
  assert.equal(red.step, 2, 'on to the next stop');
  assert.equal(red.penaltyOwed, 0);
  assert.ok(broadcasts(used.effects).some((t) => t.includes('used the Express Pass')));
  assert.equal(logs(used, 'expressUsed').length, 1);
});

test('an expired pass, or none, or the final leg, cannot be used', () => {
  const none = choose(legTwo(1, 4), 'h', 6, express);
  assert.equal(logs(none, 'taskChoiceIgnored')[0]?.fields.reason, 'noPass');
  const expired = choose(legTwo(1, 4, withPass(1)), 'h', 6, express);
  assert.equal(logs(expired, 'taskChoiceIgnored')[0]?.fields.reason, 'noPass');
  const final = choose(legTwo(1, 2, withPass(2)), 'h', 6, express);
  assert.equal(logs(final, 'taskChoiceIgnored')[0]?.fields.reason, 'noPass');
  const menu = menuTo(click(legTwo(1, 2, withPass(2)), 'h', 6), 'h');
  assert.ok(!labels(menu).includes('Use Express Pass'));
});

test('a pass skips a Roadblock at the performer pick, with no cap count', () => {
  const state = legTwo(2, 4, withPass(2));
  const solo = alone(state);
  assert.ok(labels(menuTo(click(solo, 'h', 7), 'h')).includes('Use Express Pass'));
  const used = choose(solo, 'h', 7, express);
  assert.equal(team(used.state, 'red').step, 3);
  assert.deepEqual(team(used.state, 'red').roadblockCounts, {});
});

test('a pass skips a Roadblock under way for its performer', () => {
  const state = legTwo(2, 4, withPass(2));
  const begun = choose(state, 'h', 7, { type: 'perform', who: 'h' }).state;
  assert.ok(labels(menuTo(click(begun, 'h', 7), 'h')).includes('Use Express Pass'));
  const used = choose(begun, 'h', 7, express);
  assert.equal(team(used.state, 'red').task, undefined);
  assert.equal(team(used.state, 'red').performer, undefined);
  assert.equal(team(used.state, 'red').step, 3);
});

// ── U-Turn ────────────────────────────────────────────────────────────────────────────────────

/** Red at the Detour; blue is the target (Route Info not yet cleared); green is on leg 1. */
const board = (): State => {
  const state = legTwo(1);
  return { ...state, teams: state.teams.map((t) => (t.id === 'green' ? { ...t, leg: 1 } : t)) };
};

test('the first visit opens the U-Turn board; "No U-Turn" goes on to the options', () => {
  const out = click(board(), 'h', 6);
  assert.deepEqual(labels(menuTo(out, 'h')), ['U-Turn Team Blue', 'No U-Turn']);
  const skip = choose(board(), 'h', 6, { type: 'noUturn' });
  assert.deepEqual(labels(menuTo(skip, 'h')), ['Aim', 'Shoot']);
});

test('no board on leg 1, the final leg, once used, or with no valid target', () => {
  const base = at(1);
  const onLegOne = { ...base, plan: legTwo().plan };
  assert.deepEqual(labels(menuTo(click(onLegOne, 'h', 2), 'h')), ['Aim', 'Climb']);
  const final = legTwo(1, 2);
  assert.deepEqual(labels(menuTo(click(final, 'h', 6), 'h')), ['Aim', 'Shoot']);
  const used = patch(board(), 'red', { uTurnUsed: true });
  assert.deepEqual(labels(menuTo(click(used, 'h', 6), 'h')), ['Aim', 'Shoot']);
  const checkedIn = patch(board(), 'blue', { status: 'checkedIn' });
  assert.deepEqual(labels(menuTo(click(checkedIn, 'h', 6), 'h')), ['Aim', 'Shoot']);
  const out = patch(board(), 'blue', { status: 'eliminated' });
  assert.deepEqual(labels(menuTo(click(out, 'h', 6), 'h')), ['Aim', 'Shoot']);
});

test('a team that has started this Detour, or already passed it, is not a target', () => {
  const started = patch(board(), 'blue', { task: { stopId: 6, option: 'A' } });
  assert.deepEqual(labels(menuTo(click(started, 'h', 6), 'h')), ['Aim', 'Shoot']);
  const progressed = patch(board(), 'blue', { progress: { '6:B': { hits: 1 } } });
  assert.deepEqual(labels(menuTo(click(progressed, 'h', 6), 'h')), ['Aim', 'Shoot']);
  const past = patch(board(), 'blue', { step: 2 });
  assert.deepEqual(labels(menuTo(click(past, 'h', 6), 'h')), ['Aim', 'Shoot']);
});

test('a team already at the Detour (not started) can be U-Turned: it has not started it', () => {
  const atIt = patch(board(), 'blue', { step: 1 });
  assert.ok(labels(menuTo(click(atIt, 'h', 6), 'h')).includes('U-Turn Team Blue'));
});

test('choosing a target marks it, uses the U-Turn, announces it and shows the options', () => {
  const out = choose(board(), 'h', 6, { type: 'uturn', team: 'blue' });
  assert.equal(team(out.state, 'red').uTurnUsed, true);
  assert.equal(team(out.state, 'blue').uTurnedAt, 6);
  assert.ok(broadcasts(out.effects).some((t) => /Team Red .*U-Turned.*Team Blue/.test(t)));
  assert.deepEqual(labels(menuTo(out, 'h')), ['Aim', 'Shoot']);
  assert.equal(logs(out, 'uTurned').length, 1);
  const told = notes(out).join(' ');
  assert.match(told, /U-Turn/);
});

test('a target who started in the meantime, a second use, or a made-up team is refused', () => {
  const used = choose(board(), 'h', 6, { type: 'uturn', team: 'blue' }).state;
  const again = choose(used, 'h', 6, { type: 'uturn', team: 'blue' });
  assert.equal(again.state, used);
  assert.equal(logs(again, 'taskChoiceIgnored')[0]?.fields.reason, 'noUturn');
  const late = patch(board(), 'blue', { task: { stopId: 6, option: 'B' } });
  const refused = choose(late, 'h', 6, { type: 'uturn', team: 'blue' });
  assert.equal(refused.state, late);
  const made = choose(board(), 'h', 6, { type: 'uturn', team: 'nobody' });
  assert.equal(made.state.teams.some((t) => t.uTurnedAt), false);
});

/** Blue, U-Turned at the Detour, is there with nothing started. */
const turned = (): State => {
  const state = board();
  return {
    ...state,
    teams: state.teams.map((t) => (t.id === 'blue' ? { ...t, step: 1, uTurnedAt: 6 } : t)),
  };
};
const four = (state: State, zone: 'A' | 'B', player = 'c'): State => [0, 1, 2, 3]
  .reduce((acc, slot) => shoot(acc, 6, slot, player, zone), state);
const blueChoose = (state: State, choice: TaskChoice) => choose(
  state,
  'c',
  6,
  choice,
  {},
  ['c', 'd'],
);

test('a U-Turned team does both options: A, then it is moved to B, then it moves on', () => {
  const started = blueChoose(turned(), aim).state;
  const aDone = four(started, 'A');
  assert.deepEqual(team(aDone, 'blue').task, { stopId: 6, option: 'B' }, 'moved to the other side');
  assert.equal(team(aDone, 'blue').step, 1, 'not advanced');
  assert.equal(team(aDone, 'blue').uTurnedAt, 6);
  const bDone = four(aDone, 'B');
  assert.equal(team(bDone, 'blue').step, 2);
  assert.equal(team(bDone, 'blue').task, undefined);
  assert.equal(team(bDone, 'blue').uTurnedAt, undefined, 'cleared with the Detour');
});

test('B first and then A also takes both; switching in between keeps the progress', () => {
  const started = blueChoose(turned(), shootB).state;
  const switched = blueChoose(started, { type: 'switch' }).state;
  const back = blueChoose(switched, { type: 'switch' }).state;
  const bDone = four(back, 'B');
  assert.deepEqual(team(bDone, 'blue').task, { stopId: 6, option: 'A' });
  assert.equal(team(four(bDone, 'A'), 'blue').step, 2);
});

test('a U-Turned team cannot switch back to a side it has finished', () => {
  const aDone = four(blueChoose(turned(), aim).state, 'A');
  const menu = menuTo(click(aDone, 'c', 6, ['c', 'd']), 'c');
  assert.ok(!labels(menu).some((l) => l.startsWith('Switch')));
  const refused = blueChoose(aDone, { type: 'switch' });
  assert.equal(refused.state, aDone);
  assert.equal(logs(refused, 'taskChoiceIgnored')[0]?.fields.reason, 'sideDone');
});

test('an Express Pass skips one side of a U-Turned Detour; the other must still be done', () => {
  const state = patch(turned(), 'blue', { expressPass: { expiresLeg: 2 } });
  const started = blueChoose(state, aim).state;
  const used = blueChoose(started, express);
  const blue = team(used.state, 'blue');
  assert.equal(blue.expressPass, undefined);
  assert.equal(blue.expressPassed, 'A');
  assert.deepEqual(blue.task, { stopId: 6, option: 'B' });
  assert.equal(blue.step, 1);
  const done = four(used.state, 'B');
  assert.equal(team(done, 'blue').step, 2);
  assert.equal(team(done, 'blue').expressPassed, undefined);
});

test('an Express Pass on the U-Turned option menu names the side to skip', () => {
  const state = patch(turned(), 'blue', { expressPass: { expiresLeg: 2 } });
  const menu = menuTo(blueChoose(state, { type: 'noUturn' }), 'c');
  assert.ok(labels(menu).includes('Express Pass: skip Aim'));
  assert.ok(labels(menu).includes('Express Pass: skip Shoot'));
  const used = blueChoose(state, { type: 'expressPass', option: 'B' });
  assert.equal(team(used.state, 'blue').expressPassed, 'B');
  assert.deepEqual(team(used.state, 'blue').task, { stopId: 6, option: 'A' });
});

test('quitting a U-Turned Detour quits the whole Detour once and clears the mark', () => {
  const started = blueChoose(turned(), aim).state;
  const out = blueChoose(started, { type: 'confirmQuit' });
  const blue = team(out.state, 'blue');
  assert.equal(blue.penaltyOwed, PENALTY_HOURS.quitDetour * 600);
  assert.equal(blue.uTurnedAt, undefined);
  assert.equal(blue.step, 2);
});

// ── Speed Bump ────────────────────────────────────────────────────────────────────────────────

/** Red holds a Speed Bump at the Route Info box of leg 2. */
const bumped = (pass = false): State => {
  const state = legTwo(0, 4, (t) => (t.id === 'red'
    ? { ...t, speedBump: true, ...(pass ? { expressPass: { expiresLeg: 2 } } : {}) } : t));
  return { ...state, teams: state.teams.map((t) => (t.id === 'red' ? t : { ...t, leg: 1 })) };
};
const asks = (effects: Effect[]) => effects.flatMap((e) => (e.kind === 'askQuestion' ? [e] : []));
const rightAnswer = (state: State, seq: number): string => questionAt(
  deckSeed(state.seed, 'red', 5, 'A'),
  seq,
)?.accepted[0] ?? '';
const submit = (state: State, seq: number, text: string) => reduce(state, {
  type: 'submitAnswer', player: 'h', stopId: 5, option: 'A', seq, values: [text],
});

test('with a Speed Bump the Route Info box asks a question instead of giving the clue', () => {
  const out = click(bumped(), 'h', 5);
  const [ask] = asks(out.effects);
  assert.equal(ask?.stopId, 5);
  assert.equal(ask?.to, 'h');
  assert.match(ask?.body ?? '', /Question 1 of 2/);
  assert.equal(team(out.state, 'red').step, 0, 'no clue yet');
  assert.deepEqual(team(out.state, 'red').task, { stopId: 5, option: 'A' });
});

test('two right answers clear the Speed Bump and give the Route Info clue', () => {
  let { state } = click(bumped(), 'h', 5);
  const first = submit(state, 0, rightAnswer(state, 0));
  state = first.state;
  assert.equal(asks(first.effects).length, 1, 'the second question');
  const second = submit(state, 1, rightAnswer(state, 1));
  const red = team(second.state, 'red');
  assert.equal(red.speedBump, false);
  assert.equal(red.task, undefined);
  assert.equal(red.step, 1);
  assert.ok(second.effects.some((e) => e.kind === 'title'), 'the clue is shown');
});

test('a wrong answer locks the team out; the lockout does not survive the Speed Bump', () => {
  const { state } = click(bumped(), 'h', 5);
  const wrong = submit(state, 0, 'zzzz');
  assert.ok(team(wrong.state, 'red').lockoutUntil !== undefined);
  const cleared = { ...wrong.state, clock: wrong.state.clock + 20 * 20 };
  let s = cleared;
  [0, 1].forEach(() => {
    const q = s.teams.find((t) => t.id === 'red')?.progress['5:A'];
    const seq = (q?.answered ?? 0) + (q?.wrong ?? 0);
    s = submit(s, seq, rightAnswer(s, seq)).state;
  });
  assert.equal(team(s, 'red').speedBump, false);
  assert.equal(team(s, 'red').lockoutUntil, undefined);
});

test('quitting a Speed Bump asks, costs 4 h, and gives the clue', () => {
  const { state } = click(bumped(), 'h', 5);
  const asked = choose(state, 'h', 5, { type: 'quit' });
  assert.ok(labels(menuTo(asked, 'h'))[0]?.startsWith('Yes, quit (+4 h'));
  const out = choose(state, 'h', 5, { type: 'confirmQuit' });
  const red = team(out.state, 'red');
  assert.equal(red.penaltyOwed, PENALTY_HOURS.quitSpeedBump * 600);
  assert.equal(red.speedBump, false);
  assert.equal(red.step, 1);
  assert.equal(logs(out, 'penaltyAdded')[0]?.fields.reason, 'quitSpeedBump');
});

test('with a pass, the box offers Start / Express Pass first (one form at a time)', () => {
  const out = click(bumped(true), 'h', 5);
  assert.deepEqual(labels(menuTo(out, 'h')), ['Start Speed Bump', 'Use Express Pass']);
  assert.equal(asks(out.effects).length, 0);
  const start = choose(bumped(true), 'h', 5, { type: 'start' });
  assert.equal(asks(start.effects).length, 1);
  const used = choose(bumped(true), 'h', 5, express);
  assert.equal(team(used.state, 'red').speedBump, false);
  assert.equal(team(used.state, 'red').expressPass, undefined);
  assert.equal(team(used.state, 'red').step, 1);
});

test('a team without a Speed Bump takes the Route Info clue at once', () => {
  const state = legTwo(0);
  const out = click(state, 'h', 5);
  assert.equal(team(out.state, 'red').step, 1);
  assert.equal(asks(out.effects).length, 0);
});

test('the last team on a leg gets the Speed Bump and is asked at the next Route Info', () => {
  const state = pitRace(false);
  const everyone: Action = onMat(state, 4, ['h', 'b', 'c', 'd', 'f', 'g']);
  const out = reduce(state, everyone);
  const ticked = reduce(out.state, { type: 'tick' }).state;
  assert.equal(team(ticked, 'green').speedBump, true);
  assert.equal(team(ticked, 'red').speedBump, false);
  const ready: State = {
    ...ticked,
    leg: { n: 2, phase: 'racing' },
    stops: ticked.stops.map((s) => ({ ...s, task: s.type === 'route' ? undefined : s.task })),
    teams: ticked.teams.map((t) => {
      const { departAt, ...rest } = t;
      return rest;
    }),
  };
  const box = boxOf(ready, 5);
  const green = reduce(ready, {
    type: 'interactClue',
    player: 'f',
    pos: box,
    members: ['f', 'g'].map((id) => ({ id, pos: box })),
  });
  assert.equal(asks(green.effects).length, 1);
  assert.equal(matOf(ready, 4).x > 0, true);
});

test('a Speed Bump never done by the end of the leg does not carry into the next', () => {
  const state = pitRace(false);
  const held = patch(state, 'red', { speedBump: true, uTurnedAt: 2 });
  const out = reduce(held, onMat(held, 4, ['h', 'b', 'c', 'd', 'f', 'g']));
  const ticked = reduce(out.state, { type: 'tick' }).state;
  assert.equal(team(ticked, 'red').speedBump, false);
  assert.equal(team(ticked, 'red').uTurnedAt, undefined);
});

test('an Express Pass spent mid-Detour clears the task and moves on', () => {
  const state = alone(legTwo(1, 4, withPass(2)));
  const begun = choose(state, 'h', 6, { type: 'noUturn' }).state;
  const playing = choose(begun, 'h', 6, aim).state;
  assert.ok(labels(menuTo(click(playing, 'h', 6), 'h')).includes('Use Express Pass'));
  const used = choose(playing, 'h', 6, express);
  assert.equal(team(used.state, 'red').task, undefined);
  assert.equal(team(used.state, 'red').step, 2);
  assert.equal(team(used.state, 'red').expressPass, undefined);
});

test('the Passport lists the team\'s advantages', () => {
  const base = patch(legTwo(1, 4, withPass(2)), 'red', { speedBump: true });
  const { body } = passportMenu(base, 'h');
  assert.match(body, /Express Pass: yes \(until leg 2\)/);
  assert.match(body, /U-Turn: available/);
  assert.match(body, /Speed Bump/);
  const used = patch(base, 'red', { uTurnUsed: true, expressPass: undefined, speedBump: false });
  const after = passportMenu(used, 'h').body;
  assert.match(after, /U-Turn: used/);
  assert.doesNotMatch(after, /Express Pass|Speed Bump/);
  assert.match(passportMenu(patch(base, 'red', { uTurnedAt: 6 }), 'h').body, /U-Turned/);
});

test('a forged Express Pass choice at a Pit Stop is ignored', () => {
  const state = legTwo(3, 4, withPass(2));
  const forged = choose(alone(state), 'h', 8, express);
  assert.equal(logs(forged, 'taskChoiceIgnored')[0]?.fields.reason, 'noPassHere');
  assert.equal(team(forged.state, 'red').step, 3);
});

test('stale start and noUturn choices change nothing', () => {
  const none = choose(legTwo(0), 'h', 5, { type: 'start' });
  assert.equal(logs(none, 'taskChoiceIgnored')[0]?.fields.reason, 'noSpeedBump');
  const begun = choose(board(), 'h', 6, aim).state;
  const late = choose(begun, 'h', 6, { type: 'noUturn' });
  assert.equal(logs(late, 'taskChoiceIgnored')[0]?.fields.reason, 'noBoard');
  const twice = choose(click(bumped(), 'h', 5).state, 'h', 5, { type: 'start' });
  assert.equal(logs(twice, 'taskChoiceIgnored')[0]?.fields.reason, 'noSpeedBump');
});

test('a leg that ends mid-task leaves no task, performer, lockout or U-Turn behind', () => {
  const state = patch(pitRace(false), 'green', {
    task: { stopId: 2, option: 'A' },
    performer: 'f',
    lockoutUntil: 99999,
    uTurnedAt: 2,
    step: 1,
  });
  const out = reduce(state, onMat(state, 4, ['h', 'b', 'c', 'd']));
  const ended = reduce({ ...out.state, leg: { n: 1, phase: 'grace', graceEnd: 0 } }, {
    type: 'endLeg', by: 'h',
  }).state;
  const green = team(ended, 'green');
  assert.equal(green.task, undefined);
  assert.equal(green.performer, undefined);
  assert.equal(green.lockoutUntil, undefined);
  assert.equal(green.uTurnedAt, undefined);
});

test('the HUD and standing reports cope with a task on a Route Info stop', () => {
  const { state } = click(bumped(), 'h', 5);
  const standing = reduce(state, {
    type: 'racerPositions', players: [{ id: 'h', pos: boxOf(state, 5) }],
  });
  assert.deepEqual(team(standing.state, 'red').task, { stopId: 5, option: 'A' });
  assert.equal(taskProgressText(state, team(state, 'red')), 'Speed Bump: question 1/2');
});
