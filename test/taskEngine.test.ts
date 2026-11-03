// Playing a physical task (spec §7.1, §8.2): starting it at the clue box, the events that count
// and what completion does. The Detour/Roadblock forms themselves arrive with G14.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  boxOf, racing, stopOf,
} from './helpers/race.js';
import { ARENA, BLOCK, DETOUR_PAIRS } from '../src/core/config.js';
import { hudFrames } from '../src/core/hud.js';
import { reduce } from '../src/core/race/engine.js';
import { archeryTargets } from '../src/core/tasks/archery.js';
import { parkourCourse } from '../src/core/tasks/parkour.js';

import type { DetourOption } from '../src/core/config.js';
import type { TaskContext } from '../src/core/tasks/kind.js';
import type {
  Effect, Result, State, TaskEvent,
} from '../src/core/types.js';
import type { Vec3 } from '../src/core/vec.js';

const pair = (n: number): (typeof DETOUR_PAIRS)[number] => {
  const found = DETOUR_PAIRS[n];
  if (!found) throw new Error(`no detour pair ${n}`);
  return found;
};
const aimClimb = pair(0);
const fightFind = pair(1);

/** Stop 2 is Aim/Climb, stop 6 Fight/Find (Find is the only playable one), 3 an archery
 * Roadblock, 7 a hunt Roadblock; all teams are heading for stop 2 or 3 as set by `at`. */
function course(): State {
  const state = racing();
  const task = new Map<number, Stop['task']>([
    [2, { type: 'detour', options: [aimClimb.a, aimClimb.b] }],
    [3, { type: 'roadblock', kind: 'archery' }],
    [6, { type: 'detour', options: [fightFind.a, fightFind.b] }],
    [7, { type: 'roadblock', kind: 'hunt' }],
  ]);
  return { ...state, stops: state.stops.map((s) => ({ ...s, task: task.get(s.id) })) };
}
type Stop = State['stops'][number];

const at = (state: State, step: number, teams = ['red', 'blue']): State => ({
  ...state,
  teams: state.teams.map((t) => (teams.includes(t.id) ? { ...t, step } : t)),
});

const click = (state: State, player: string, stopId: number, members = ['h', 'b']): Result => {
  const box = boxOf(state, stopId);
  return reduce(state, {
    type: 'interactClue', player, pos: box, members: members.map((id) => ({ id, pos: box })),
  });
};
const event = (state: State, player: string, ev: TaskEvent): Result => reduce(
  state,
  { type: 'taskEvent', player, event: ev },
);
const stood = (state: State, ids: [string, Vec3][]): Result => reduce(state, {
  type: 'racerPositions', players: ids.map(([id, pos]) => ({ id, pos })),
});
const teamOf = (state: State, id: string) => {
  const found = state.teams.find((t) => t.id === id);
  if (!found) throw new Error(`no team ${id}`);
  return found;
};
const kinds = (effects: Effect[]): string[] => effects.map((e) => e.kind);

const ctxFor = (state: State, stopId: number, zone: 'A' | 'B', leg = 1): TaskContext => {
  const stop = stopOf(state, stopId);
  return {
    stop,
    zone,
    centre: { ...stop.pos, x: stop.pos.x + (zone === 'A' ? -6 : 6) },
    leg,
    teams: state.teams.length,
    hidden: stop.zones?.[zone]?.hidden ?? [],
    label: 'Aim',
  };
};

/** Red at the Detour (Aim: archery) with the task begun. */
function aiming(): State {
  const out = click(at(course(), 1), 'h', 2);
  assert.equal(out.refusal, undefined);
  return out.state;
}
const farShot = (state: State, slot: number): TaskEvent => {
  const target = archeryTargets(ctxFor(state, 2, 'A'))[slot];
  if (!target) throw new Error('no target');
  return {
    type: 'projectileHit',
    block: target,
    shooter: { x: target.x + 12, y: target.y - 2, z: target.z },
  };
};

function farShotAt(state: State, stopId: number, slot: number): TaskEvent {
  const target = archeryTargets(ctxFor(state, stopId, 'A'))[slot];
  if (!target) throw new Error('no target');
  return {
    type: 'projectileHit', block: target, shooter: { x: target.x + 12, y: target.y, z: target.z },
  };
}

test('the Detour box starts its first playable option: zone built, bow and arrows given', () => {
  const state = at(course(), 1);
  const out = click(state, 'h', 2);
  assert.equal(out.refusal, undefined);
  const red = teamOf(out.state, 'red');
  assert.deepEqual(red.task, { stopId: 2, option: 'A' });
  assert.deepEqual(red.progress['2:A'], { hits: 0 });
  assert.equal(red.step, 1, 'not advanced until the task is done');
  const zone = out.effects.find((e) => e.kind === 'zoneBlocks');
  assert.equal(zone?.kind === 'zoneBlocks' && zone.zone, 'A');
  assert.equal(zone?.kind === 'zoneBlocks' && zone.stop, 2);
  const gifts = out.effects.filter((e) => e.kind === 'giveVanilla');
  assert.equal(gifts.length, 4, 'a bow and arrows for each of the two members');
  assert.deepEqual(stopOf(out.state, 2).zones?.A, { kind: 'archery' });
  assert.ok(out.logs?.some((l) => l.event === 'taskStarted'));
});

test('a Detour whose first option is not playable yet starts the second (Fight/Find: Find)', () => {
  const base = course();
  const state = {
    ...base, teams: base.teams.map((t) => (t.id === 'red' ? { ...t, leg: 2, step: 1 } : t)),
  };
  const legTwo = { ...state, leg: { n: 2, phase: 'racing' as const } };
  const begun = click(legTwo, 'h', 6);
  assert.equal(begun.refusal, undefined);
  assert.deepEqual(teamOf(begun.state, 'red').task, { stopId: 6, option: 'B' });
  const hidden = stopOf(begun.state, 6).zones?.B?.hidden;
  assert.equal(hidden?.length, 2, 'one wool per team');
  const zone = begun.effects.find((e) => e.kind === 'zoneBlocks');
  assert.equal(zone?.kind === 'zoneBlocks' && zone.zone, 'B');
});

test('hunt stops still say they come later', () => {
  const base = at(course(), 2, ['red']);
  const task = { type: 'roadblock' as const, kind: 'hunt' as const };
  const hunt = { ...base, stops: base.stops.map((s) => (s.id === 3 ? { ...s, task } : s)) };
  const out = click(hunt, 'h', 3);
  assert.equal(out.refusal, 'stopNotReady');
});

test('everyone must be present before a task starts', () => {
  const state = at(course(), 1);
  const box = boxOf(state, 2);
  const out = reduce(state, {
    type: 'interactClue',
    player: 'h',
    pos: box,
    members: [{ id: 'h', pos: box }, { id: 'b', pos: { ...box, x: box.x + 30 } }],
  });
  assert.equal(out.refusal, 'notTogether');
  assert.equal(teamOf(out.state, 'red').task, undefined);
});

test('a second team at the same zone gets its gear but no second build', () => {
  const first = click(at(course(), 1), 'h', 2).state;
  const out = click(first, 'c', 2, ['c', 'd']);
  assert.equal(out.refusal, undefined);
  assert.ok(!kinds(out.effects).includes('zoneBlocks'));
  assert.equal(out.effects.filter((e) => e.kind === 'giveVanilla').length, 4);
  assert.deepEqual(teamOf(out.state, 'blue').task, { stopId: 2, option: 'A' });
});

test('clicking again mid-task shows the progress and changes nothing', () => {
  const state = aiming();
  const again = click(state, 'h', 2);
  assert.equal(again.refusal, undefined);
  assert.equal(again.state, state);
  const note = again.effects.find((e) => e.kind === 'notify');
  assert.match(note?.kind === 'notify' ? note.text : '', /Aim: targets 0\/4/);
});

test('archery: four distinct far hits finish the Detour and send the team to its next clue', () => {
  let state = aiming();
  for (const slot of [0, 1, 1, 2]) {
    const out = event(state, 'h', farShot(state, slot));
    state = out.state;
  }
  assert.equal(teamOf(state, 'red').step, 1, 'three distinct targets are not enough');
  assert.equal(teamOf(state, 'red').progress['2:A']?.hits, 0b111);
  const done = event(state, 'b', farShot(state, 4));
  const red = teamOf(done.state, 'red');
  assert.equal(red.step, 2);
  assert.equal(red.lastClearedStop, 2);
  assert.equal(red.task, undefined);
  const title = done.effects.find((e) => e.kind === 'title');
  assert.match(title?.kind === 'title' ? title.text : '', /Roadblock/);
  assert.ok(kinds(done.effects).includes('sidebar'));
  assert.ok(done.logs?.some((l) => l.event === 'taskDone'));
});

test('a shot from a team not playing, or from the wrong place, changes nothing', () => {
  const state = aiming();
  assert.equal(event(state, 'c', farShot(state, 0)).state, state, 'blue has no task');
  assert.equal(event(state, 'e', farShot(state, 0)).state, state, 'no team');
  const near = farShot(state, 0);
  if (near.type !== 'projectileHit') throw new Error('shot');
  const close = { ...near, shooter: { ...near.shooter, x: near.block.x + 3 } };
  assert.equal(event(state, 'h', close).state, state);
  assert.equal(reduce({ ...state, phase: 'paused' }, {
    type: 'taskEvent', player: 'h', event: farShot(state, 0),
  }).state.teams, state.teams);
});

test('a Roadblock is for its performer only', () => {
  const state = { ...at(course(), 2, ['red']) };
  const out = click(state, 'b', 3);
  assert.equal(out.refusal, undefined);
  const red = teamOf(out.state, 'red');
  assert.equal(red.performer, 'b');
  assert.deepEqual(red.task, { stopId: 3, option: 'A' });
  const shot = (who: string): Result => event(out.state, who, farShotAt(out.state, 3, 0));
  assert.equal(shot('h').state, out.state, 'a teammate does not count');
  assert.equal(teamOf(shot('b').state, 'red').progress['3:A']?.hits, 1);
  const gifts = out.effects.filter((e) => e.kind === 'giveVanilla');
  assert.ok(gifts.every((g) => g.kind === 'giveVanilla' && g.to === 'b'));
});

const climbFirst: [DetourOption, DetourOption] = [aimClimb.b, aimClimb.a];

test('parkour: standing on the gold block, reported by position, finishes the Detour', () => {
  const swapped = course();
  const state = {
    ...swapped,
    stops: swapped.stops.map((s) => (s.id === 2
      ? { ...s, task: { type: 'detour' as const, options: climbFirst } }
      : s)),
  };
  const begun = click(at(state, 1), 'h', 2).state;
  const { gold } = parkourCourse(ctxFor(begun, 2, 'A'));
  const wrong = stood(begun, [['h', { x: gold.x, y: gold.y + 1, z: gold.z - 6 }]]);
  assert.equal(teamOf(wrong.state, 'red').step, 1);
  const onGold = { x: gold.x + 0.5, y: gold.y + 1, z: gold.z + 0.5 };
  const win = stood(begun, [['h', onGold], ['b', { x: 0, y: 0, z: 0 }]]);
  assert.equal(teamOf(win.state, 'red').step, 2);
  assert.equal(teamOf(win.state, 'red').task, undefined);
});

function digging(): State {
  const state = course();
  const legTwo = {
    ...state,
    leg: { n: 2, phase: 'racing' as const },
    teams: state.teams.map((t) => ({ ...t, leg: 2, step: 1 })),
  };
  return click(legTwo, 'h', 6).state;
}

test('haystack: breaking a hidden wool finishes it; the broken wool leaves the hidden list', () => {
  const state = digging();
  const hidden = stopOf(state, 6).zones?.B?.hidden ?? [];
  const [first, second] = hidden;
  if (!first || !second) throw new Error('two hidden');
  const wrong = event(state, 'h', {
    type: 'blockBroken', block: { ...first, x: first.x + 5 }, id: BLOCK.yellowWool,
  });
  assert.equal(wrong.state, state);
  const done = event(state, 'h', { type: 'blockBroken', block: first, id: BLOCK.yellowWool });
  assert.equal(teamOf(done.state, 'red').step, 2);
  assert.deepEqual(stopOf(done.state, 6).zones?.B?.hidden, [second]);
  assert.ok(!kinds(done.effects).includes('zoneBlocks'), 'nobody needs a refill yet');
});

test('haystack: the pile is rebuilt when the wool runs out and another team digs', () => {
  const first = digging();
  const begun = click({
    ...first,
    teams: first.teams.map((t) => (t.id === 'blue' ? { ...t, leg: 2, step: 1 } : t)),
  }, 'c', 6, ['c', 'd']).state;
  const [a, b] = stopOf(begun, 6).zones?.B?.hidden ?? [];
  if (!a || !b) throw new Error('two hidden');
  const one = event(begun, 'h', { type: 'blockBroken', block: a, id: BLOCK.yellowWool }).state;
  const out = event(one, 'b', { type: 'blockBroken', block: b, id: BLOCK.yellowWool });
  const refill = out.effects.find((e) => e.kind === 'zoneBlocks');
  assert.ok(refill, 'a rebuild is ordered');
  const fresh = stopOf(out.state, 6).zones?.B;
  assert.equal(fresh?.hidden?.length, 2);
  assert.equal(fresh?.refills, 1);
  assert.equal(teamOf(out.state, 'blue').step, 1, 'blue is still digging');
  assert.ok(out.logs?.some((l) => l.event === 'zoneRefilled'));
});

test('haystack: a team that starts on an emptied pile gets it rebuilt', () => {
  const first = digging();
  const [a, b] = stopOf(first, 6).zones?.B?.hidden ?? [];
  if (!a || !b) throw new Error('two hidden');
  const empty = event(
    event(first, 'h', { type: 'blockBroken', block: a, id: BLOCK.yellowWool }).state,
    'b',
    { type: 'blockBroken', block: b, id: BLOCK.yellowWool },
  ).state;
  assert.deepEqual(stopOf(empty, 6).zones?.B?.hidden, []);
  const late = click({
    ...empty,
    teams: empty.teams.map((t) => (t.id === 'blue' ? { ...t, leg: 2, step: 1 } : t)),
  }, 'c', 6, ['c', 'd']);
  assert.ok(kinds(late.effects).includes('zoneBlocks'));
  assert.equal(stopOf(late.state, 6).zones?.B?.hidden?.length, 2);
});

test('the HUD task line shows the progress of the team\'s task', () => {
  const state = aiming();
  const view = {
    id: 'h', head: { x: 0, y: 71, z: 0 }, yaw: 0, overworld: true,
  };
  const frame = hudFrames(state, [view], { trail: false })[0]?.text;
  assert.match(frame?.split('\n')[1] ?? '', /Aim: targets 0\/4/);
  const hit = event(state, 'h', farShot(state, 0)).state;
  const after = hudFrames(hit, [view], { trail: false })[0]?.text;
  assert.match(after?.split('\n')[1] ?? '', /Aim: targets 1\/4/);
});

test('zone ops stay inside the arena', () => {
  const out = click(at(course(), 1), 'h', 2);
  const zone = out.effects.find((e) => e.kind === 'zoneBlocks');
  if (zone?.kind !== 'zoneBlocks') throw new Error('zone');
  const { pos } = stopOf(out.state, 2);
  for (const op of zone.ops) {
    const spots: Vec3[] = [];
    if (op.kind === 'fill') spots.push(op.from, op.to);
    if (op.kind === 'set') spots.push(op.pos);
    for (const p of spots) {
      assert.ok(Math.abs(p.x - pos.x) <= ARENA.half && Math.abs(p.z - pos.z) <= ARENA.half);
    }
  }
});

test('a zone whose build failed is forgotten, the team told, and the next use retries', () => {
  const state = aiming();
  const failed = reduce(state, { type: 'zoneBuildFailed', stop: 2, zone: 'A' });
  assert.equal(stopOf(failed.state, 2).zones?.A, undefined);
  assert.ok(failed.effects.some((e) => e.kind === 'notify' && e.text.includes('did not build')));
  assert.ok(failed.logs?.some((l) => l.event === 'zoneForgotten'));
  const again = reduce(failed.state, { type: 'zoneBuildFailed', stop: 2, zone: 'A' });
  assert.equal(again.state, failed.state);
  const retry = click(failed.state, 'h', 2);
  assert.ok(kinds(retry.effects).includes('zoneBlocks'));
  assert.equal(retry.state.teams.find((t) => t.id === 'red')?.task?.option, 'A');
  assert.ok(stopOf(retry.state, 2).zones?.A);
  assert.ok(retry.logs?.some((l) => l.event === 'zoneBuilt'));
});

test('events outside a running race, or from a team that is not racing, change nothing', () => {
  const state = aiming();
  const shot = farShot(state, 0);
  for (const phase of ['paused', 'dayEnded'] as const) {
    assert.equal(event({ ...state, phase }, 'h', shot).state.phase, phase);
    assert.deepEqual(
      event({ ...state, phase }, 'h', shot).state.teams,
      state.teams,
    );
  }
  const out = { ...state, teams: state.teams.map((t) => ({ ...t, status: 'checkedIn' as const })) };
  assert.equal(event(out, 'h', shot).state, out);
  const paused = { ...state, phase: 'paused' as const };
  assert.equal(stood(paused, [['h', { x: 0, y: 0, z: 0 }]]).state, paused);
});

test('racerPositions returns the same state when no task or mat moved', () => {
  const state = aiming();
  const away = stood(state, [['h', { x: 0, y: 70, z: 0 }], ['c', { x: 5, y: 70, z: 5 }]]);
  assert.equal(away.state, state);
});

test('a task that points at a missing option is ignored, not thrown into a tick', () => {
  const state = aiming();
  const retask = (task: { stopId: number; option: 'A' | 'B' }): State => ({
    ...state, teams: state.teams.map((t) => (t.id === 'red' ? { ...t, task } : t)),
  });
  const stale = retask({ stopId: 2, option: 'B' });
  const roadblockStop = retask({ stopId: 99, option: 'A' });
  const view = {
    id: 'h', head: { x: 0, y: 71, z: 0 }, yaw: 0, overworld: true,
  };
  for (const broken of [stale, roadblockStop]) {
    assert.doesNotThrow(() => hudFrames(broken, [view], { trail: false }));
    assert.equal(event(broken, 'h', farShot(broken, 0)).state, broken);
    assert.equal(stood(broken, [['h', { x: 1, y: 70, z: 1 }]]).state, broken);
  }
});

test('while a Roadblock is under way only its performer must be near the box', () => {
  const begun = click(at(course(), 2, ['red']), 'b', 3).state;
  const box = boxOf(begun, 3);
  const far = { ...box, x: box.x + 40 };
  const call = (members: { id: string; pos: Vec3 }[]): Result => reduce(begun, {
    type: 'interactClue', player: 'b', pos: box, members,
  });
  const ok = call([{ id: 'b', pos: box }, { id: 'h', pos: far }]);
  assert.equal(ok.refusal, undefined);
  assert.equal(call([{ id: 'b', pos: far }, { id: 'h', pos: box }]).refusal, 'notTogether');
});
