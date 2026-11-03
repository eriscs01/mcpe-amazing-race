// Derived plan (spec §4) and elimination schedule (spec §8.6): legs, radius and boundary follow
// from the settings; eliminations from the number of teams.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  boundary, derivePlan, eliminationLegs, planOf, planSummary,
} from '../src/core/plan.js';
import { createState } from '../src/core/state.js';

import type { Settings, Team } from '../src/core/types.js';

const settings = (days: number, minutesPerDay: number): Settings => ({
  ...createState(1).settings, days, minutesPerDay,
});

test('the default settings give 2 legs per day, 6 legs and a 1,800-block radius', () => {
  const plan = derivePlan(settings(3, 60), 0);
  assert.deepEqual(plan, {
    legs: 6, legsPerDay: 2, radius: 1800, eliminationLegs: [],
  });
});

test('legs per day is floor(minutes / 30), at least 1', () => {
  assert.equal(derivePlan(settings(1, 30), 0).legsPerDay, 1);
  assert.equal(derivePlan(settings(1, 45), 0).legsPerDay, 1);
  assert.equal(derivePlan(settings(1, 90), 0).legsPerDay, 3);
  assert.equal(derivePlan(settings(1, 120), 0).legsPerDay, 4);
});

test('total legs are days × legs per day, clamped to 2–12', () => {
  assert.equal(derivePlan(settings(1, 30), 0).legs, 2);
  assert.equal(derivePlan(settings(2, 90), 0).legs, 6);
  assert.equal(derivePlan(settings(5, 120), 0).legs, 12);
});

test('radius is 1,200 + 100 × legs, clamped to 1,400–2,400', () => {
  assert.equal(derivePlan(settings(1, 30), 0).radius, 1400);
  assert.equal(derivePlan(settings(3, 90), 0).radius, 2100);
  assert.equal(derivePlan(settings(5, 120), 0).radius, 2400);
});

test('the boundary warns at R + 200 and stops at R + 300', () => {
  assert.deepEqual(boundary(1800), { warn: 2000, hard: 2100 });
});

test('eliminations leave 3 teams in the final, using the last legs before the final', () => {
  assert.deepEqual(eliminationLegs(3, 6), []);
  assert.deepEqual(eliminationLegs(4, 6), [5]);
  assert.deepEqual(eliminationLegs(6, 6), [3, 4, 5]);
  assert.deepEqual(eliminationLegs(0, 6), []);
});

test('eliminations are capped at L − 1, so only the final leg is elimination-free', () => {
  assert.deepEqual(eliminationLegs(12, 4), [1, 2, 3]);
  assert.deepEqual(eliminationLegs(5, 2), [1]);
});

test('leg 1 is non-elimination whenever fewer than L − 1 eliminations are needed', () => {
  for (let teams = 2; teams <= 12; teams += 1) {
    const legs = eliminationLegs(teams, 12);
    if (legs.length < 11) assert.ok(!legs.includes(1), `teams=${teams}`);
  }
});

test('the plan of a state uses its settings and current team count', () => {
  const teams = Array.from({ length: 5 }, (_, i) => ({ id: `t${i}` }) as Team);
  const plan = planOf({ ...createState(1), teams });
  assert.deepEqual(plan.eliminationLegs, [4, 5]);
});

test('the summary reads like the spec example, with thousands grouped', () => {
  const plan = derivePlan(settings(3, 60), 6);
  assert.equal(planSummary(plan, 6), '6 legs · 3 eliminations · ~1,800-block radius');
  assert.equal(
    planSummary(derivePlan(settings(3, 60), 4), 4),
    '6 legs · 1 elimination · ~1,800-block radius',
  );
});

test('before teams exist the summary says eliminations depend on them', () => {
  assert.equal(
    planSummary(derivePlan(settings(3, 60), 0), 0),
    '6 legs · ~1,800-block radius · eliminations set by teams',
  );
});
