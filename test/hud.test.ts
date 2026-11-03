// The racer HUD (spec §9.1): compass bar, distance, task line and particle trail, built from
// the state and what the adapter reads from each online player.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  boxOf, matOf, pitRace, racing, stopOf, team,
} from './helpers/race.js';
import { HUD } from '../src/core/config.js';
import { compassBar, hudFrames } from '../src/core/hud.js';

import type { HudView } from '../src/core/hud.js';
import type { State } from '../src/core/types.js';

const WIDTH = HUD.barCells;
const MID = (WIDTH - 1) / 2;

/** Ben stands at the start facing `yaw`; stop 1 of the fixture is at x 100, z −10. */
const view = (yaw: number, over: Partial<HudView> = {}): HudView => ({
  id: 'b', head: { x: 0, y: 71.6, z: 0 }, yaw, overworld: true, ...over,
});
const frameOf = (state: State, v: HudView, trail = false) => hudFrames(state, [v], { trail })[0];
const cellOf = (bar: string) => bar.slice(1, -1).search(/O/);

test('the trail cadence is a whole number of HUD refreshes', () => {
  assert.equal(HUD.trailEveryTicks % HUD.everyTicks, 0);
});

test('the bar is 21 cells between brackets with the target at its relative bearing', () => {
  const bar = compassBar(0);
  assert.equal(bar?.length, WIDTH + 2);
  assert.equal(cellOf(bar ?? ''), MID, 'dead ahead is the centre');
  assert.equal(cellOf(compassBar(90) ?? ''), WIDTH - 1, 'hard right is the last cell');
  assert.equal(cellOf(compassBar(-90) ?? ''), 0, 'hard left is the first cell');
  assert.ok(cellOf(compassBar(45) ?? '') > MID);
  assert.equal(compassBar(0)?.[1 + MID], 'O');
  assert.equal(compassBar(45)?.[1 + MID], '|', 'the centre cell stays marked off-centre');
});

test('behind the player there is no bar; exactly ±90 is still on it', () => {
  assert.equal(compassBar(90.01), undefined);
  assert.equal(compassBar(-90.01), undefined);
  assert.equal(compassBar(180), undefined);
  assert.ok(compassBar(90));
});

test('facing south with the target to the west puts the target right of centre', () => {
  const state = racing();
  const west = {
    ...state,
    stops: state.stops.map((s) => (
      s.id === 1 ? { ...s, pos: { x: -100, y: 70, z: 0 } } : s)),
  };
  const bar = (frameOf(west, view(0))?.text ?? '').split(' ')[0] ?? '';
  assert.ok(cellOf(bar) > MID, bar);
});

test('the navigation line shows bar, horizontal metres and the stop label', () => {
  const state = racing();
  const frame = frameOf(state, view(-90));
  // Facing east, stop 1 (x 100, z −10) is 6° to the left: one cell left of the heading mark.
  assert.match(frame?.text ?? '', /^\[-{9}O\|-{10}\] 100m Route Info$/);
  assert.equal(frame?.to, 'b');
});

test('a target behind shows TURN AROUND with the distance', () => {
  const frame = frameOf(racing(), view(90));
  assert.equal(frame?.text, '<< TURN AROUND >> 100m Route Info');
});

test('standing on the box shows the bar centred, not NaN', () => {
  const state = racing();
  const box = boxOf(state, 1);
  const frame = frameOf(state, view(37, { head: { ...box, y: box.y + 1 } }));
  assert.match(frame?.text ?? '', /^\[-{10}O-{10}\] 0m Route Info$/);
});

test('a blind stop gets coordinates only: no bar, no distance, no trail', () => {
  const state = racing();
  const blind = {
    ...state,
    stops: state.stops.map((s) => (s.id === 1 ? { ...s, blind: true } : s)),
  };
  const frame = frameOf(blind, view(-90), true);
  assert.equal(frame?.text, 'Route Info: X 100, Z -10');
  assert.equal(frame?.trail, undefined);
});

test('the trail is three points toward the target, below eye level, only on trail frames', () => {
  const state = racing();
  assert.equal(frameOf(state, view(0))?.trail, undefined);
  const { trail } = frameOf(state, view(0), true) ?? {};
  const ahead = (d: number) => d * (100 / Math.hypot(100, 10));
  trail?.forEach((p, i) => assert.ok(Math.abs(p.x - ahead(HUD.trailDistances[i] ?? 0)) < 1e-9));
  assert.equal(trail?.length, 3);
  assert.ok(trail?.every((p) => p.y === 71.6 - HUD.trailDrop));
  assert.ok(trail?.every((p) => p.z < 0));
});

test('no frames unless the race is running, and none for eliminated or teamless players', () => {
  const state = racing();
  assert.deepEqual(hudFrames({ ...state, phase: 'paused' }, [view(0)], { trail: true }), []);
  const out = {
    ...state,
    teams: state.teams.map((t) => (
      t.id === 'red' ? { ...t, status: 'eliminated' as const } : t)),
  };
  assert.deepEqual(hudFrames(out, [view(0)], { trail: false }), []);
  const strangers = [view(0, { id: 'e' }), view(0, { id: 'nobody' })];
  assert.deepEqual(hudFrames(state, strangers, { trail: false }), []);
});

test('the grace period still shows the HUD', () => {
  const state = racing();
  const grace = { ...state, leg: { n: 1, phase: 'grace' as const } };
  assert.ok(frameOf(grace, view(0)));
});

test('outside the Overworld the racer is told to return, with no trail', () => {
  const frame = frameOf(racing(), view(0, { overworld: false }), true);
  assert.equal(frame?.text, 'Return to the Overworld');
  assert.equal(frame?.trail, undefined);
});

test('the departure countdown is a second line, per team, in real seconds', () => {
  const state = racing();
  const waiting = {
    ...state,
    clock: 100,
    teams: state.teams.map((t) => (t.id === 'red' ? { ...t, departAt: 100 + 7 * 20 - 5 } : t)),
  };
  const [bar, task] = (frameOf(waiting, view(-90))?.text ?? '').split('\n');
  assert.match(bar ?? '', /Route Info$/);
  assert.equal(task, 'Departing in 7s');
  assert.equal(frameOf(waiting, view(-90, { id: 'c' }))?.text.includes('\n'), false);
});

test('penalty owed and a lockout are task-line parts only while they last', () => {
  const state = racing();
  const red = {
    ...team('red', '§c', ['h', 'b']), leg: 1, penaltyOwed: 45 * 20, lockoutUntil: 50 + 3 * 20,
  };
  const held = { ...state, clock: 50, teams: state.teams.map((t) => (t.id === 'red' ? red : t)) };
  assert.equal(frameOf(held, view(-90))?.text.split('\n')[1], 'Penalty owed: 45s | Locked out: 3s');
  const paid = { ...red, penaltyOwed: 0 };
  const later = {
    ...held,
    clock: 200,
    teams: held.teams.map((t) => (t.id === 'red' ? paid : t)),
  };
  assert.equal(frameOf(later, view(-90))?.text.includes('\n'), false);
});

test('a team with no target left gets no navigation line', () => {
  const state = racing();
  const done = { ...state, teams: state.teams.map((t) => ({ ...t, step: 9 })) };
  assert.deepEqual(hudFrames(done, [view(0)], { trail: true }), []);
  assert.equal(stopOf(state, 1).type, 'route');
});

test('on the way to a Pit Stop the bar points at its mat, not its clue box', () => {
  const state = pitRace();
  const mat = matOf(state, 4);
  const at = view(0, { id: 'b', head: { x: mat.x, y: 71.6, z: mat.z - 10 } });
  assert.equal(frameOf(state, at)?.text, '[----------O----------] 10m Pit Stop');
});

test('a team counting down on the mat sees the time left; owing is not repeated', () => {
  const state = pitRace();
  const mat = matOf(state, 4);
  const waiting = {
    ...state,
    clock: 100,
    teams: state.teams.map((t) => (t.id === 'red'
      ? {
        ...t, arrivedAt: 40, penaltyOwed: 400, step: 4,
      } : t)),
  };
  const frame = frameOf(waiting, view(0, { head: { x: mat.x, y: 71.6, z: mat.z } }));
  assert.equal(frame?.text, 'Checking in: 17s');
});

test('the last team out sees the grace countdown', () => {
  const state = pitRace();
  const grace = {
    ...state,
    clock: 100,
    leg: { n: 1, phase: 'grace' as const, graceEnd: 700 },
    teams: state.teams.map((t) => (t.id === 'red'
      ? t : { ...t, status: 'checkedIn' as const, step: 4 })),
  };
  assert.match(frameOf(grace, view(0))?.text ?? '', /\nGrace: 30s$/);
  assert.equal(frameOf(grace, view(0, { id: 'c' })), undefined);
});

test('a checked-in team has no bar, only its departure countdown', () => {
  const state = pitRace();
  const done = {
    ...state,
    clock: 10,
    teams: state.teams.map((t) => (t.id === 'red'
      ? { ...t, status: 'checkedIn' as const, step: 4 } : t)),
  };
  assert.deepEqual(hudFrames(done, [view(0)], { trail: true }), []);
  const leaving = {
    ...done,
    teams: done.teams.map((t) => (t.id === 'red' ? {
      ...t, leg: 2, step: 0, departAt: 210,
    } : t)),
  };
  assert.match(frameOf(leaving, view(0))?.text ?? '', /\nDeparting in 10s$/);
});
