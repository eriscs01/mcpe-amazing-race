// Quiz and Recall through the reducer (spec §7.1, §8.2): the question forms, a correct answer, a
// wrong one and its lockout, a stale form, and who may answer.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { boxOf, racing } from './helpers/race.js';
import { DETOUR_PAIRS, TASK, TICKS_PER_SECOND } from '../src/core/config.js';
import { deckSeed, questionAt } from '../src/core/quiz/bank.js';
import { reduce } from '../src/core/race/engine.js';

import type { DetourOption } from '../src/core/config.js';
import type {
  Effect, Result, State, Stop,
} from '../src/core/types.js';

type Ask = Extract<Effect, { kind: 'askQuestion' }>;

const brainsBrawn = DETOUR_PAIRS.find((p) => p.a.kind === 'quiz' && p.b.kind === 'hunt');
if (!brainsBrawn) throw new Error('no Brains/Brawn pair');
const options: [DetourOption, DetourOption] = [brainsBrawn.a, brainsBrawn.b];

/** Stop 2: Brains (quiz) or Brawn (hunt); 3: a quiz Roadblock; 7: the final Recall Roadblock. */
function course(): State {
  const task = new Map<number, Stop['task']>([
    [2, { type: 'detour', options }],
    [3, { type: 'roadblock', kind: 'quiz' }],
    [7, { type: 'roadblock', kind: 'recall' }],
  ]);
  const state = racing();
  return {
    ...state,
    stops: state.stops.map((s) => ({ ...s, task: task.get(s.id) })),
    teams: state.teams.map((t) => (t.id === 'red' ? { ...t, step: 1 } : t)),
  };
}

const team = (state: State, id = 'red') => {
  const found = state.teams.find((t) => t.id === id);
  if (!found) throw new Error(`no team ${id}`);
  return found;
};
const asks = (out: Result): Ask[] => out.effects.filter((e): e is Ask => e.kind === 'askQuestion');
const only = (out: Result): Ask => {
  const [first, ...rest] = asks(out);
  assert.ok(first && rest.length === 0, `one question, got ${asks(out).length}`);
  return first;
};
const notices = (out: Result): string[] => out.effects.flatMap((e) => (
  e.kind === 'notify' ? [e.code] : []));

const click = (state: State, player: string, stopId: number, members = ['h', 'b']): Result => {
  const box = boxOf(state, stopId);
  return reduce(state, {
    type: 'interactClue', player, pos: box, members: members.map((id) => ({ id, pos: box })),
  });
};
const submit = (
  state: State,
  player: string,
  ask: { stopId: number; option: 'A' | 'B'; seq: number },
  values: (string | number)[],
): Result => reduce(state, {
  type: 'submitAnswer', player, ...ask, values,
});

/** The right answer to the question `ask` shows, from the same seeded deck the core uses. */
const right = (state: State, ask: Ask, teamId = 'red'): string => {
  const q = questionAt(deckSeed(state.seed, teamId, ask.stopId, ask.option), ask.seq);
  return q.accepted[0] ?? '';
};
const wrong = 'zzzz';

/** Red begins the Brains quiz at stop 2. */
const begun = (): { state: State; ask: Ask } => {
  const out = click(course(), 'h', 2);
  assert.equal(out.refusal, undefined);
  return { state: out.state, ask: only(out) };
};

test('the Brains box starts the quiz and asks the first question in a text form', () => {
  const { state, ask } = begun();
  assert.deepEqual(team(state).task, { stopId: 2, option: 'A' });
  assert.deepEqual(team(state).progress['2:A'], { answered: 0, wrong: 0 });
  assert.equal(ask.to, 'h');
  assert.equal(ask.seq, 0);
  assert.equal(ask.fields.length, 1);
  assert.equal(ask.fields[0]?.type, 'text');
  assert.equal(ask.fields[0]?.label, questionAt(deckSeed(state.seed, 'red', 2, 'A'), 0).prompt);
});

test('a correct answer moves on to the next question', () => {
  const { state, ask } = begun();
  const out = submit(state, 'h', ask, [right(state, ask)]);
  assert.deepEqual(team(out.state).progress['2:A'], { answered: 1, wrong: 0 });
  assert.equal(only(out).seq, 1);
  assert.equal(team(out.state).lockoutUntil, undefined);
});

test('all four Detour questions answered completes the task and sends the next clue', () => {
  let { state, ask } = begun();
  for (let i = 0; i < TASK.quiz.detour; i += 1) {
    const out = submit(state, 'h', ask, [right(state, ask)]);
    state = out.state;
    if (i < TASK.quiz.detour - 1) ask = only(out);
    else assert.equal(asks(out).length, 0);
  }
  assert.equal(team(state).task, undefined);
  assert.equal(team(state).step, 2, 'the clue for the next stop');
});

test('a wrong answer locks the team out for 10 seconds and asks nothing more', () => {
  const { state, ask } = begun();
  const out = submit(state, 'h', ask, [wrong]);
  assert.deepEqual(team(out.state).progress['2:A'], { answered: 0, wrong: 1 });
  assert.equal(team(out.state).lockoutUntil, state.clock + 10 * TICKS_PER_SECOND);
  assert.equal(asks(out).length, 0);
  assert.deepEqual(notices(out), ['lockedOut']);
  assert.ok(out.logs?.some((l) => l.event === 'lockout'));
});

test('while locked out, answers are refused and the box says how long is left', () => {
  const { state, ask } = begun();
  const locked = submit(state, 'h', ask, [wrong]).state;
  const again = submit(locked, 'b', { ...ask, seq: 1 }, ['anything']);
  assert.deepEqual(again.state, locked);
  assert.deepEqual(notices(again), ['lockedOut']);
  const box = click(locked, 'h', 2);
  assert.equal(asks(box).length, 0);
  assert.deepEqual(notices(box), ['lockedOut']);
});

test('after the lockout a fresh question is asked, and the old one is not asked again', () => {
  const { state, ask } = begun();
  const locked = submit(state, 'h', ask, [wrong]).state;
  const later = { ...locked, clock: locked.clock + 10 * TICKS_PER_SECOND };
  const out = click(later, 'h', 2);
  const next = only(out);
  assert.equal(next.seq, 1, 'a wrong answer uses up a draw');
  assert.notEqual(next.fields[0]?.label, ask.fields[0]?.label);
});

test('a stale form is not a wrong answer: no lockout, and the current question is asked', () => {
  const { state, ask } = begun();
  const first = submit(state, 'b', ask, [right(state, ask)]);
  const stale = submit(first.state, 'h', ask, [right(state, ask)]);
  assert.deepEqual(team(stale.state).progress['2:A'], { answered: 1, wrong: 0 });
  assert.equal(team(stale.state).lockoutUntil, undefined);
  assert.equal(only(stale).seq, 1);
  assert.equal(only(stale).to, 'h');
  assert.ok(stale.logs?.some((l) => l.event === 'answerStale'));
});

test('using the box mid-quiz asks again instead of saying "task in progress"', () => {
  const { state } = begun();
  const out = click(state, 'b', 2);
  assert.equal(only(out).to, 'b');
  assert.deepEqual(notices(out), []);
});

test('a Roadblock quiz has three questions and only the performer may answer', () => {
  const plain = course();
  const base = {
    ...plain,
    teams: plain.teams.map((t) => (t.id === 'red' ? { ...t, step: 2 } : t)),
  };
  const started = click(base, 'h', 3);
  const ask = only(started);
  const other = submit(started.state, 'b', ask, [right(started.state, ask)]);
  assert.deepEqual(other.state, started.state);
  assert.ok(other.logs?.some((l) => l.event === 'answerIgnored'));
  let { state } = started;
  let current = ask;
  for (let i = 0; i < TASK.quiz.roadblock; i += 1) {
    const out = submit(state, 'h', current, [right(state, current)]);
    state = out.state;
    if (i < TASK.quiz.roadblock - 1) current = only(out);
  }
  assert.equal(team(state).task, undefined);
});

test('a paused race ignores answers, and a form for another task is ignored', () => {
  const { state, ask } = begun();
  const paused = submit({ ...state, phase: 'paused' }, 'h', ask, [right(state, ask)]);
  assert.deepEqual(paused.state.teams, state.teams);
  const other = submit(state, 'h', { ...ask, stopId: 3 }, [right(state, ask)]);
  assert.deepEqual(other.state, state);
  const wrongOption = submit(state, 'h', { ...ask, option: 'B' }, [right(state, ask)]);
  assert.deepEqual(wrongOption.state, state);
});

test('the same race asks the same question after a save round-trip', () => {
  const { state, ask } = begun();
  const reloaded = JSON.parse(JSON.stringify(state)) as State;
  const out = click(reloaded, 'b', 2);
  assert.equal(only(out).fields[0]?.label, ask.fields[0]?.label);
});

/** The final leg: red at the Recall Roadblock, with two earlier Pit Stops (stops 1 and 4). */
function finalLeg(): State {
  const state = course();
  return {
    ...state,
    stops: state.stops.map((s) => (s.id === 1 ? { ...s, type: 'pit' as const } : s)),
    teams: state.teams.map((t) => (t.id === 'red' ? { ...t, leg: 2, step: 2 } : t)),
  };
}

test('Recall asks one dropdown per earlier leg, each listing every Pit Stop name', () => {
  const out = click(finalLeg(), 'h', 7);
  const ask = only(out);
  assert.equal(ask.fields.length, 2);
  for (const f of ask.fields) {
    assert.equal(f.type, 'dropdown');
    assert.deepEqual([...(f.type === 'dropdown' ? f.options : [])].sort(), ['Place 1', 'Place 4']);
  }
});

test('Recall: matching every leg to its Pit Stop completes the task', () => {
  const out = click(finalLeg(), 'h', 7);
  const ask = only(out);
  const pick = (f: Ask['fields'][number], name: string): number => (
    f.type === 'dropdown' ? f.options.indexOf(name) : -1);
  const [one, two] = ask.fields;
  assert.ok(one && two);
  const done = submit(out.state, 'h', ask, [pick(one, 'Place 1'), pick(two, 'Place 4')]);
  assert.equal(team(done.state).task, undefined);
  assert.equal(team(done.state).lockoutUntil, undefined);
});

test('Recall: any wrong leg locks the team out for 20 seconds, then asks again', () => {
  const out = click(finalLeg(), 'h', 7);
  const ask = only(out);
  const [one, two] = ask.fields;
  const idx = (f: typeof one, name: string): number => (
    f?.type === 'dropdown' ? f.options.indexOf(name) : -1);
  const bad = submit(out.state, 'h', ask, [idx(one, 'Place 4'), idx(two, 'Place 4')]);
  assert.equal(team(bad.state).lockoutUntil, out.state.clock + 20 * TICKS_PER_SECOND);
  assert.equal(team(bad.state).task?.stopId, 7);
  assert.deepEqual(notices(bad), ['lockedOut']);
});

test('Recall with a single earlier leg is always right (the literal spec)', () => {
  const state = course();
  const solo = {
    ...state,
    teams: state.teams.map((t) => (t.id === 'red' ? { ...t, leg: 2, step: 2 } : t)),
  };
  const out = click(solo, 'h', 7);
  const ask = only(out);
  assert.equal(ask.fields.length, 1);
  const done = submit(out.state, 'h', ask, [0]);
  assert.equal(team(done.state).task, undefined);
});
