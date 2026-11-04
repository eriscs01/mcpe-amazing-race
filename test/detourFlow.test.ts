// Detour and Roadblock flow (spec §7.3, §8.2, §8.8): the option and performer menus, switching,
// quitting and its penalty, the Roadblock cap, and a stale form changing nothing.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  at, boxOf, choose, click, labels, menuTo, notes, red, shoot, tick,
} from './helpers/flow.js';
import { onMat } from './helpers/race.js';
import { DETOUR_PAIRS, ITEM, PENALTY_HOURS } from '../src/core/config.js';
import { reduce } from '../src/core/race/engine.js';

import type { Result, TaskChoice } from '../src/core/types.js';

const aim = { type: 'option', option: 'A' } as const;
const climb = { type: 'option', option: 'B' } as const;

test('a Detour box shows the option menu to the clicker and starts nothing', () => {
  const out = click(at(1), 'h', 2);
  const menu = menuTo(out, 'h');
  assert.deepEqual(labels(menu), ['Aim', 'Climb']);
  assert.equal(red(out.state).task, undefined);
  assert.ok(!out.effects.some((e) => e.kind === 'zoneBlocks'));
});

test('choosing an option starts it: zone, gear for everyone, progress', () => {
  const out = choose(click(at(1), 'h', 2).state, 'h', 2, aim);
  assert.deepEqual(red(out.state).task, { stopId: 2, option: 'A' });
  assert.deepEqual(red(out.state).progress['2:A'], { hits: 0 });
  assert.equal(out.effects.filter((e) => e.kind === 'giveVanilla').length, 4);
  assert.ok(out.logs?.some((l) => l.event === 'taskStarted'));
});

test('option B is reachable (Mind, Climb): its own zone and progress key', () => {
  const out = choose(at(1), 'b', 2, climb);
  assert.deepEqual(red(out.state).task, { stopId: 2, option: 'B' });
  assert.ok(red(out.state).progress['2:B']);
  const zone = out.effects.find((e) => e.kind === 'zoneBlocks');
  assert.equal(zone?.kind === 'zoneBlocks' && zone.zone, 'B');
});

test('a choice that no longer fits is ignored and logged', () => {
  const started = choose(at(1), 'h', 2, aim).state;
  const again = choose(started, 'b', 2, climb);
  assert.equal(again.state, started, 'an option cannot be picked twice');
  assert.ok(again.logs?.some((l) => l.event === 'taskChoiceIgnored'));
  const elsewhere = choose(at(1), 'h', 3, aim);
  assert.equal(red(elsewhere.state).task, undefined, 'not the team\'s current stop');
  assert.ok(elsewhere.logs?.some((l) => l.event === 'taskChoiceIgnored'));
  const paused = choose({ ...at(1), phase: 'paused' }, 'h', 2, aim);
  assert.ok(paused.logs?.some((l) => l.event === 'taskChoiceIgnored'));
  const teamless = choose(at(1), 'e', 2, aim);
  assert.ok(teamless.logs?.some((l) => l.event === 'taskChoiceIgnored'));
});

test('mid-task the menu offers gear, switching and quitting, not the Roadblock things', () => {
  const started = choose(at(1), 'h', 2, aim).state;
  const menu = menuTo(click(started, 'b', 2), 'b');
  assert.deepEqual(labels(menu), ['Get gear again', 'Switch to Climb', 'Quit (+6 h)']);
  assert.match(menu.body, /Aim: targets 0\/4/);
});

test('switching keeps the progress of both options and the team\'s lockout', () => {
  const shot = shoot(choose(at(1), 'h', 2, aim).state, 2, 0);
  const until = shot.clock + 100;
  const locked = { ...shot, teams: shot.teams.map((t) => ({ ...t, lockoutUntil: until })) };
  const there = choose(locked, 'h', 2, { type: 'switch' });
  assert.deepEqual(red(there.state).task, { stopId: 2, option: 'B' });
  assert.deepEqual(red(there.state).progress['2:A'], { hits: 1 });
  assert.ok(red(there.state).progress['2:B']);
  assert.equal(red(there.state).lockoutUntil, until, 'switching is no way round a lockout');
  const back = choose(there.state, 'b', 2, { type: 'switch' });
  assert.deepEqual(red(back.state).task, { stopId: 2, option: 'A' });
  assert.deepEqual(red(back.state).progress['2:A'], { hits: 1 });
});

test('quitting asks first, then costs 6 h, keeps the progress and gives the next clue', () => {
  const started = choose(at(1), 'h', 2, aim).state;
  const asked = choose(started, 'h', 2, { type: 'quit' });
  assert.equal(asked.state, started, 'nothing yet');
  assert.deepEqual(labels(menuTo(asked, 'h')), ['Yes, quit (+6 h = 180 s)', 'Keep playing']);
  const locked = { ...started, teams: started.teams.map((t) => ({ ...t, lockoutUntil: 99999 })) };
  const out = choose(locked, 'h', 2, { type: 'confirmQuit' });
  const team = red(out.state);
  assert.equal(team.penaltyOwed, PENALTY_HOURS.quitDetour * 600);
  assert.equal(team.task, undefined);
  assert.equal(team.lockoutUntil, undefined);
  assert.equal(team.step, 2, 'on to the next stop');
  assert.deepEqual(team.progress['2:A'], { hits: 0 });
  assert.ok(out.logs?.some((l) => l.event === 'penaltyAdded'
    && l.fields.hours === 6 && l.fields.reason === 'quitDetour'));
  assert.ok(notes(out).some((t) => t.includes('6 h')));
  assert.ok(out.effects.some((e) => e.kind === 'title'), 'the next clue');
});

test('Keep playing shows the progress and changes nothing', () => {
  const started = choose(at(1), 'h', 2, aim).state;
  const out = choose(started, 'h', 2, { type: 'status' });
  assert.equal(out.state, started);
  assert.match(notes(out).join(' '), /Aim: targets 0\/4/);
});

test('a confirmed quit with no task under way is ignored', () => {
  const out = choose(at(1), 'h', 2, { type: 'confirmQuit' });
  assert.equal(red(out.state).penaltyOwed, 0);
  assert.ok(out.logs?.some((l) => l.event === 'taskChoiceIgnored'));
});

test('a quit penalty is served at the Pit Stop mat before the team checks in', () => {
  const quit = choose(choose(at(1), 'h', 2, aim).state, 'h', 2, { type: 'confirmQuit' }).state;
  const onPit = {
    ...quit, teams: quit.teams.map((t) => (t.id === 'red' ? { ...t, step: 3 } : t)),
  };
  const arrived = reduce(onPit, onMat(onPit, 4, ['h', 'b'])).state;
  assert.equal(red(arrived).status, 'racing');
  assert.equal(red(arrived).arrivedAt, onPit.clock);
  // A tick moves the clock on by one.
  const almost = tick({ ...arrived, clock: onPit.clock + 3598 });
  assert.equal(red(almost.state).status, 'racing');
  const served = tick({ ...arrived, clock: onPit.clock + 3599 });
  assert.equal(red(served.state).status, 'checkedIn');
});

test('Muscle: the hand-in button tallies the inventory it is chosen with, not the click\'s', () => {
  const pair = DETOUR_PAIRS[2];
  if (!pair) throw new Error('no pair');
  const state = at(1, { 2: { type: 'detour', options: [pair.a, pair.b] } });
  const started = choose(state, 'h', 2, aim).state;
  const menu = menuTo(click(started, 'h', 2), 'h');
  assert.ok(labels(menu).includes('Hand in'));
  const short = choose(started, 'h', 2, { type: 'continue' }, { h: { [ITEM.wheatSeeds]: 4 } });
  assert.equal(short.state, started);
  assert.match(notes(short).join(' '), /you hold 4 of 10/);
  const pooled = { h: { [ITEM.wheatSeeds]: 6 }, b: { [ITEM.wheatSeeds]: 4 } };
  const enough = choose(started, 'h', 2, { type: 'continue' }, pooled);
  assert.equal(enough.effects.filter((e) => e.kind === 'takeVanilla').length, 2);
  assert.equal(red(enough.state).step, 2);
});

test('Get gear again gives only what the player lacks', () => {
  const started = choose(at(1), 'h', 2, aim).state;
  const bare = choose(started, 'b', 2, { type: 'gear' });
  const given = bare.effects.filter((e) => e.kind === 'giveVanilla');
  assert.deepEqual(given.map((e) => e.kind === 'giveVanilla' && [e.to, e.item, e.count]), [
    ['b', ITEM.bow, 1], ['b', ITEM.arrow, 24],
  ]);
  const arrows = (out: Result): number[] => out.effects.flatMap((e) => (
    e.kind === 'giveVanilla' ? [e.count] : []));
  const some = { b: { [ITEM.bow]: 1, [ITEM.arrow]: 20 } };
  assert.deepEqual(arrows(choose(started, 'b', 2, { type: 'gear' }, some)), [4]);
  const all = { b: { [ITEM.bow]: 1, [ITEM.arrow]: 24 } };
  const full = choose(started, 'b', 2, { type: 'gear' }, all);
  assert.deepEqual(full.effects.filter((e) => e.kind === 'giveVanilla'), []);
});

// ── Roadblock ───────────────────────────────────────────────────────────────────────────────

test('a Roadblock box shows the hint, not the task, and who may perform', () => {
  const out = click(at(2, undefined, ['red']), 'b', 3);
  const menu = menuTo(out, 'b');
  assert.match(menu.body, /Who has a good eye\?/);
  assert.doesNotMatch(`${menu.title} ${menu.body}`, /archery|targets/i);
  assert.deepEqual(labels(menu), ['Hana', 'Ben']);
  assert.equal(red(out.state).task, undefined);
});

test('the cap hides members who have performed enough; at the cap for all, everyone may', () => {
  const base = at(2, undefined, ['red']);
  const used = (counts: Record<string, number>) => ({
    ...base, teams: base.teams.map((t) => ({ ...t, roadblockCounts: counts })),
  });
  // Two Roadblocks and two members: each may perform one.
  assert.deepEqual(labels(menuTo(click(used({ h: 1 }), 'b', 3), 'b')), ['Ben']);
  assert.deepEqual(labels(menuTo(click(used({ h: 1, b: 1 }), 'b', 3), 'b')), ['Hana', 'Ben']);
});

test('the performer is picked: counted, equipped, the task revealed', () => {
  const base = at(2, undefined, ['red']);
  const out = choose(base, 'b', 3, { type: 'perform', who: 'h' });
  const team = red(out.state);
  assert.equal(team.performer, 'h');
  assert.deepEqual(team.task, { stopId: 3, option: 'A' });
  assert.equal(team.roadblockCounts.h, 1);
  assert.deepEqual(
    out.effects.flatMap((e) => (e.kind === 'giveVanilla' ? [e.to] : [])),
    ['h', 'h'],
    'the bow and arrows go to the performer alone',
  );
  const title = out.effects.find((e) => e.kind === 'title');
  assert.match(title?.kind === 'title' ? title.text : '', /Archery: targets/);
});

test('the first pick wins; a second is told who is performing and counts nothing', () => {
  const first = choose(at(2, undefined, ['red']), 'b', 3, { type: 'perform', who: 'h' }).state;
  const second = choose(first, 'h', 3, { type: 'perform', who: 'b' });
  assert.equal(second.state, first);
  assert.equal(red(second.state).roadblockCounts.b, undefined);
  assert.match(notes(second).join(' '), /Hana is performing/);
});

test('a member at the cap cannot be picked while a teammate is under it', () => {
  const base = at(2, undefined, ['red']);
  const used = { ...base, teams: base.teams.map((t) => ({ ...t, roadblockCounts: { h: 1 } })) };
  const out = choose(used, 'b', 3, { type: 'perform', who: 'h' });
  assert.equal(red(out.state).performer, undefined);
  assert.ok(out.logs?.some((l) => l.event === 'taskChoiceIgnored'));
});

test('an offline member cannot be picked', () => {
  const pick: TaskChoice = { type: 'perform', who: 'h' };
  const out = choose(at(2, undefined, ['red']), 'b', 3, pick, undefined, ['b']);
  assert.equal(red(out.state).performer, undefined);
  assert.ok(out.logs?.some((l) => l.event === 'taskChoiceIgnored'));
});

test('mid-Roadblock the performer gets the menu with Quit; others are told who performs', () => {
  const started = choose(at(2, undefined, ['red']), 'b', 3, { type: 'perform', who: 'h' }).state;
  assert.deepEqual(labels(menuTo(click(started, 'h', 3), 'h')), ['Get gear again', 'Quit (+4 h)']);
  const other = click(started, 'b', 3);
  assert.ok(!other.effects.some((e) => e.kind === 'taskMenu'));
  assert.match(notes(other).join(' '), /Hana is performing/);
  const others = choose(started, 'b', 3, { type: 'confirmQuit' });
  assert.equal(others.state, started, 'only the performer quits');
});

test('with the performer offline any member may quit, and nothing else', () => {
  const started = choose(at(2, undefined, ['red']), 'b', 3, { type: 'perform', who: 'h' }).state;
  const out = click(started, 'b', 3, ['b']);
  assert.deepEqual(labels(menuTo(out, 'b')), ['Quit (+4 h)']);
  const quit = choose(started, 'b', 3, { type: 'confirmQuit' }, undefined, ['b']);
  assert.equal(red(quit.state).penaltyOwed, PENALTY_HOURS.quitRoadblock * 600);
  assert.equal(red(quit.state).performer, undefined);
  assert.equal(red(quit.state).step, 3);
  assert.equal(red(quit.state).roadblockCounts.h, 1, 'the turn stays used');
});

test('finishing a Roadblock frees the performer slot for the next one', () => {
  const picked = choose(at(2, undefined, ['red']), 'b', 3, { type: 'perform', who: 'h' }).state;
  const state = [0, 1, 2, 3].reduce((acc, slot) => shoot(acc, 3, slot), picked);
  assert.equal(red(state).task, undefined);
  assert.equal(red(state).performer, undefined);
  assert.equal(red(state).step, 3);
});

test('every Roadblock counts toward the cap total, the final Recall included', () => {
  const base = at(2, undefined, ['red']);
  const out = click(base, 'b', 3);
  assert.equal(base.stops.filter((s) => s.type === 'roadblock').length, 2);
  assert.deepEqual(labels(menuTo(out, 'b')), ['Hana', 'Ben']);
});

test('a team that is not heading for the stop cannot use its menu', () => {
  const choice: TaskChoice = { type: 'perform', who: 'c' };
  const out = choose(at(2, undefined, ['red']), 'c', 3, choice, undefined, ['c', 'd']);
  assert.ok(out.logs?.some((l) => l.event === 'taskChoiceIgnored'));
  assert.equal(boxOf(out.state, 3).x, 300);
});

test('a menu button pressed after the teammates walked off is ignored', () => {
  const started = choose(at(1), 'h', 2, aim).state;
  const box = boxOf(started, 2);
  const far = { ...box, x: box.x + 40 };
  const out = reduce(started, {
    type: 'taskChoice',
    player: 'h',
    stopId: 2,
    choice: { type: 'confirmQuit' },
    members: [{ id: 'h', pos: box }, { id: 'b', pos: far }],
  });
  assert.equal(out.state, started);
  const line = out.logs?.find((l) => l.event === 'taskChoiceIgnored');
  assert.equal(line?.fields.reason, 'notTogether');
  assert.equal(line?.fields.team, 'red');
  assert.equal(line?.fields.leg, 1);
});

test('switching to an option already played re-gives only the gear that is missing', () => {
  const started = choose(at(1), 'h', 2, aim).state;
  const there = choose(started, 'h', 2, { type: 'switch' }, { h: {}, b: {} }).state;
  const held = { h: { [ITEM.bow]: 1, [ITEM.arrow]: 24 }, b: { [ITEM.bow]: 1, [ITEM.arrow]: 24 } };
  const back = choose(there, 'h', 2, { type: 'switch' }, held);
  assert.deepEqual(red(back.state).task, { stopId: 2, option: 'A' });
  assert.deepEqual(back.effects.filter((e) => e.kind === 'giveVanilla'), []);
});

const muscleMind = DETOUR_PAIRS[2];
const brainsBrawn = DETOUR_PAIRS[4];
if (!muscleMind || !brainsBrawn) throw new Error('no pairs');

test('Mind (option B, a quiz) can be played: its first question goes to who chose it', () => {
  const state = at(1, { 2: { type: 'detour', options: [muscleMind.a, muscleMind.b] } });
  const out = choose(state, 'b', 2, climb);
  assert.deepEqual(red(out.state).task, { stopId: 2, option: 'B' });
  const ask = out.effects.find((e) => e.kind === 'askQuestion');
  assert.equal(ask?.kind === 'askQuestion' && ask.option, 'B');
  assert.equal(ask?.kind === 'askQuestion' && ask.to, 'b');
  assert.deepEqual(red(out.state).progress['2:B'], { answered: 0, wrong: 0 });
});

test('a Hunt menu has no gear button, and switching back spawns only the missing husks', () => {
  const state = at(1, { 2: { type: 'detour', options: [brainsBrawn.b, brainsBrawn.a] } });
  const started = choose(state, 'h', 2, aim).state;
  assert.ok(!labels(menuTo(click(started, 'h', 2), 'h')).includes('Get gear again'));
  const killed = reduce(started, { type: 'targetDied', tag: 'hunt:red:2:A', killer: 'h' }).state;
  const there = choose(killed, 'h', 2, { type: 'switch' }).state;
  const back = choose(there, 'h', 2, { type: 'switch' });
  const spawn = back.effects.find((e) => e.kind === 'spawnTargets');
  assert.deepEqual(spawn?.kind === 'spawnTargets' && [spawn.count, spawn.topUp], [2, true]);
});

test('a second option pick is told what the team is doing', () => {
  const started = choose(at(1), 'h', 2, aim).state;
  const second = choose(started, 'b', 2, climb);
  assert.equal(second.state, started);
  assert.match(notes(second).join(' '), /Your team is doing Aim/);
});
