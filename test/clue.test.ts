// Clue text (spec §8.3), the clue-box rules (spec §8.2) and the sidebar (spec §10).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { boxOf, racing, stopOf } from './helpers/race.js';
import { clueBoxAt, clueText, sidebarRows } from '../src/core/clue.js';
import { reduce } from '../src/core/race/engine.js';

import type { Effect, State } from '../src/core/types.js';
import type { Vec3 } from '../src/core/vec.js';

interface Member { id: string; pos?: Vec3 }

const beside = (state: State, ids: string[]): Member[] => ids.map((id) => {
  const box = boxOf(state, 1);
  return { id, pos: { ...box, x: box.x + 2 } };
});
const click = (state: State, player: string, over: { pos?: Vec3; members?: Member[] } = {}) => (
  reduce(state, {
    type: 'interactClue',
    player,
    pos: over.pos ?? boxOf(state, 1),
    members: over.members ?? beside(state, ['h', 'b']),
  }));
const firstText = (effects: Effect[]): string => {
  const found = effects.find((e) => e.kind === 'notify' || e.kind === 'title');
  return found && 'text' in found ? found.text : '';
};
const withStep = (state: State, id: string, step: number): State => ({
  ...state, teams: state.teams.map((t) => (t.id === id ? { ...t, step } : t)),
});

test('a clue states leg, stop type, place, coordinates and what to look for', () => {
  const state = racing();
  assert.equal(
    clueText(state, stopOf(state, 1)),
    'Leg 1 · Route Info — Make your way to Place 1 (X 100, Z −10). '
    + 'Find the clue box under the yellow beam.',
  );
});

test('clue wording per stop type, with the blind-segment addition', () => {
  const state = racing();
  assert.match(clueText(state, stopOf(state, 2)), /^Leg 1 · Detour — .*yellow beam\.$/);
  assert.match(clueText(state, stopOf(state, 3)), /^Leg 1 · Roadblock — .*red beam\.$/);
  assert.match(
    clueText(state, stopOf(state, 4)),
    /^Check in at the Pit Stop: Place 4 \(X 400, Z −40\)\. .*lime beam\./,
  );
  assert.match(clueText(state, { ...stopOf(state, 2), blind: true }), /by coordinates only\.$/);
  assert.match(clueText(state, stopOf(state, 8)), /Finish/);
});

test('the Pit Stop clue warns of elimination only on an elimination leg', () => {
  const state = racing();
  const plan = { legs: 2, legsPerDay: 1, radius: 1000 };
  const pit = stopOf(state, 4);
  assert.match(clueText({ ...state, plan: { ...plan, eliminationLegs: [1] } }, pit), /eliminated/);
  assert.doesNotMatch(
    clueText({ ...state, plan: { ...plan, eliminationLegs: [] } }, pit),
    /eliminated/,
  );
});

test('clueBoxAt finds a built stop by the block above its floor', () => {
  const state = racing();
  assert.equal(clueBoxAt(state, boxOf(state, 2))?.id, 2);
  assert.equal(clueBoxAt(state, stopOf(state, 2).pos), undefined);
  const unbuilt = { ...state, stops: state.stops.map((s) => ({ ...s, built: false })) };
  assert.equal(clueBoxAt(unbuilt, boxOf(state, 2)), undefined);
});

test('the current target opens; Route Info advances the step and shows the next clue', () => {
  const out = click(racing(), 'h');
  assert.equal(out.refusal, undefined);
  const red = out.state.teams.find((t) => t.id === 'red');
  assert.equal(red?.step, 1);
  assert.equal(red?.lastClearedStop, 1);
  assert.equal(out.state.teams.find((t) => t.id === 'blue')?.step, 0);
  const clue = out.effects.find((e) => e.kind === 'title');
  assert.deepEqual(clue?.kind === 'title' ? clue.to : [], ['h', 'b']);
  assert.match(firstText(out.effects), /^Leg 1 · Detour — /);
  assert.ok(out.effects.some((e) => e.kind === 'sidebar'));
});

test('another team\'s box, or a box out of order, is "Not your clue box"', () => {
  const state = racing();
  assert.equal(click(state, 'h', { pos: boxOf(state, 2) }).refusal, 'notYourBox');
  assert.equal(click(withStep(state, 'blue', 1), 'c').refusal, 'notYourBox');
});

test('a player on no team, or whose team is not racing, is told it is not theirs', () => {
  const state = racing();
  const out = click(state, 'e');
  assert.equal(out.refusal, 'notYourBox');
  assert.match(firstText(out.effects), /Not your clue box/);
  const checkedIn = state.teams.map((t) => ({ ...t, status: 'checkedIn' as const }));
  const parked = { ...state, teams: checkedIn };
  assert.equal(click(parked, 'h').refusal, 'notYourBox');
});

test('every online teammate must be within 10 blocks, in this dimension', () => {
  const state = racing();
  const base = boxOf(state, 1);
  const at = (dx: number): Member[] => [
    { id: 'h', pos: base }, { id: 'b', pos: { ...base, x: base.x + dx } },
  ];
  const out = click(state, 'h', { members: at(11) });
  assert.equal(out.refusal, 'notTogether');
  assert.match(firstText(out.effects), /All teammates must be present/);
  assert.equal(out.state, state);
  const otherWorld = [{ id: 'h', pos: base }, { id: 'b' }];
  assert.equal(click(state, 'h', { members: otherWorld }).refusal, 'notTogether');
  assert.equal(click(state, 'h', { members: at(10) }).refusal, undefined);
});

test('a teammate who is offline does not block (only the listed online members count)', () => {
  const state = racing();
  assert.equal(click(state, 'h', { members: beside(state, ['h']) }).refusal, undefined);
});

test('before GO, or when the race is not running, the box does nothing', () => {
  const state = racing();
  assert.equal(click({ ...state, leg: { n: 1, phase: 'departing' } }, 'h').refusal, 'notRacing');
  assert.equal(click({ ...state, phase: 'paused' }, 'h').refusal, 'notRacing');
});

test('a Detour box is not playable yet: no advance, a clear message', () => {
  const state = withStep(racing(), 'red', 1);
  const out = click(state, 'h', { pos: boxOf(state, 2) });
  assert.equal(out.refusal, 'stopNotReady');
  assert.equal(out.state.teams[0]?.step, 1);
});

test('the sidebar lists teams coloured, scoring stops cleared, [OUT] for the eliminated', () => {
  const state = racing();
  const [red, blue] = state.teams;
  const teams = [
    { ...red, leg: 2, step: 1 },
    { ...blue, status: 'eliminated' as const, step: 2 },
  ] as State['teams'];
  assert.deepEqual(sidebarRows({ ...state, teams }), [
    { name: '§cRed§r', score: 5 },
    { name: '[OUT] §9Blue§r', score: 2 },
  ]);
});

test('clearing a Route Info stop is logged with the team, leg and step', () => {
  assert.deepEqual(click(racing(), 'h').logs?.[0], {
    event: 'clueCleared',
    fields: {
      team: 'red', leg: 1, step: 0, stop: 1,
    },
  });
});
