// Teams (spec §4, §8.7): auto-assign as even as possible around the chosen size, swap two
// players, the host's view of the teams, colours from the fixed list, and the Roadblock cap.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TEAM_COLORS } from '../src/core/config.js';
import { reduce } from '../src/core/race/engine.js';
import { createState } from '../src/core/state.js';
import {
  mayPerform, roadblockCap, roadblockCapFor, swapCandidates, teamSizes, teamsView,
} from '../src/core/teams.js';

import type { Action, Phase, State } from '../src/core/types.js';

const NAMES: Record<string, string> = {
  h: 'Hana', a: 'Ana', b: 'Ben', c: 'Cy', d: 'Dan', e: 'Eve',
};
const hosted = (hostRaces = false): State => {
  const base = createState(1);
  return {
    ...base,
    hostId: 'h',
    settings: { ...base.settings, hostRaces },
    players: Object.fromEntries(Object.entries(NAMES).map(([id, name]) => [id, { name }])),
  };
};
const online = (...ids: string[]) => ids.map((id) => ({ id, name: NAMES[id] ?? id }));
const assign = (ids: string[], seed = 7, by = 'h'): Action => ({
  type: 'autoAssignTeams', by, players: online(...ids), seed,
});
const swap = (a: string, b: string, by = 'h'): Action => ({
  type: 'swapPlayers', by, a, b,
});
const members = (s: State) => s.teams.map((t) => t.members);

test('team sizes are as even as possible and never above the chosen size', () => {
  assert.deepEqual(teamSizes(10, 4), [4, 3, 3]);
  assert.deepEqual(teamSizes(9, 3), [3, 3, 3]);
  assert.deepEqual(teamSizes(8, 2), [2, 2, 2, 2]);
  assert.deepEqual(teamSizes(7, 4), [4, 3]);
  assert.deepEqual(teamSizes(5, 2), [2, 2, 1]);
  assert.deepEqual(teamSizes(0, 2), []);
});

test('auto-assign puts every online racer on a coloured team, but not a non-racing host', () => {
  const out = reduce(hosted(), assign(['h', 'a', 'b', 'c', 'd']));
  assert.equal(out.refusal, undefined);
  const { teams, players } = out.state;
  assert.deepEqual(teams.map((t) => [t.id, t.name, t.color]), [
    ['red', 'Red', TEAM_COLORS[0].code],
    ['blue', 'Blue', TEAM_COLORS[1].code],
  ]);
  assert.deepEqual(members(out.state).flat().sort(), ['a', 'b', 'c', 'd']);
  for (const team of teams) {
    assert.equal(team.members.length, 2);
    for (const id of team.members) assert.equal(players[id]?.teamId, team.id);
  }
  assert.equal(players.h?.teamId, undefined);
});

test('a new team starts racing with no progress, penalties or advantages', () => {
  const [team] = reduce(hosted(), assign(['a', 'b', 'c', 'd'])).state.teams;
  assert.deepEqual({ ...team, members: [] }, {
    id: 'red',
    name: 'Red',
    color: TEAM_COLORS[0].code,
    members: [],
    status: 'racing',
    leg: 0,
    step: 0,
    penaltyOwed: 0,
    checkIns: [],
    roadblockCounts: {},
    uTurnUsed: false,
    speedBump: false,
    progress: {},
    lastClearedStop: 0,
  });
});

test('a racing host is assigned like everyone else', () => {
  const out = reduce(hosted(true), assign(['h', 'a', 'b', 'c']));
  assert.deepEqual(members(out.state).flat().sort(), ['a', 'b', 'c', 'h']);
});

test('the shuffle follows the seed, so a host report can be reproduced', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const first = members(reduce(hosted(), assign(ids, 3)).state);
  assert.deepEqual(members(reduce(hosted(), assign(ids, 3)).state), first);
  const others = [4, 5, 6, 7, 8].map((seed) => members(reduce(hosted(), assign(ids, seed)).state));
  assert.ok(others.some((m) => JSON.stringify(m) !== JSON.stringify(first)));
});

test('auto-assign replaces earlier teams; players no longer online lose their team', () => {
  const before = reduce(hosted(), assign(['a', 'b', 'c', 'd'])).state;
  const after = reduce(before, assign(['a', 'b', 'c', 'e'])).state;
  assert.equal(after.teams.length, 2);
  assert.equal(after.players.d?.teamId, undefined);
  assert.ok(after.players.e?.teamId);
});

test('auto-assign records names, tells each racer their team and logs the outcome', () => {
  const out = reduce(hosted(), {
    type: 'autoAssignTeams',
    by: 'h',
    players: [{ id: 'n', name: 'Nia' }, ...online('a', 'b')],
    seed: 1,
  });
  assert.equal(out.state.players.n?.name, 'Nia');
  const notes = out.effects.filter((e) => e.kind === 'notify');
  assert.deepEqual(notes.map((e) => e.to).sort(), ['a', 'b', 'h', 'n']);
  for (const note of notes) assert.equal(note.code, 'teamsAssigned');
  const nia = notes.find((e) => e.to === 'n')?.text ?? '';
  assert.match(nia, /^You are on §.(Red|Blue)§r( with \w+)?\.$/);
  assert.deepEqual(out.logs, [{
    event: 'teamsAssigned',
    fields: {
      teams: 2, racers: 3, sizes: '2,1', seed: 1, by: 'h',
    },
  }]);
});

test('teammates are named in the racer\'s message', () => {
  const out = reduce(hosted(), assign(['a', 'b', 'c', 'd']));
  const team = out.state.teams[0];
  const [first, second] = team?.members ?? [];
  const note = out.effects.find((e) => e.kind === 'notify' && e.to === first);
  assert.match(note?.kind === 'notify' ? note.text : '', new RegExp(`with ${NAMES[second ?? '']}`));
});

test('fewer than 2 teams is refused and the host is told why', () => {
  const state = hosted();
  const out = reduce(state, assign(['h', 'a', 'b']));
  assert.equal(out.refusal, 'tooFewTeams');
  assert.equal(out.state, state);
  assert.deepEqual(out.effects.map((e) => e.kind === 'notify' && e.to), ['h']);
});

test('more teams than colours is refused', () => {
  const ids = Array.from({ length: 2 * TEAM_COLORS.length + 1 }, (_, i) => `p${i}`);
  const out = reduce(hosted(), assign(ids));
  assert.equal(out.refusal, 'tooManyTeams');
});

test('only the host may change teams, and only before the race starts', () => {
  assert.equal(reduce(hosted(), assign(['a', 'b', 'c', 'd'], 1, 'a')).refusal, 'notHost');
  assert.equal(reduce(hosted(), swap('a', 'b', 'a')).refusal, 'notHost');
  const allowed: Phase[] = ['setup', 'generating', 'ready'];
  const blocked: Phase[] = ['running', 'paused', 'dayEnded', 'finished'];
  for (const phase of allowed) {
    assert.equal(reduce({ ...hosted(), phase }, assign(['a', 'b', 'c', 'd'])).refusal, undefined);
  }
  for (const phase of blocked) {
    assert.equal(reduce({ ...hosted(), phase }, assign(['a', 'b', 'c', 'd'])).refusal, 'badPhase');
    assert.equal(reduce({ ...hosted(), phase }, swap('a', 'b')).refusal, 'badPhase');
  }
});

const twoTeams = (): State => reduce(hosted(), assign(['a', 'b', 'c', 'd'])).state;

test('swapping players on different teams exchanges their places', () => {
  const state = twoTeams();
  const [[a1, a2], [b1, b2]] = members(state) as [string[], string[]];
  const out = reduce(state, swap(a1 ?? '', b2 ?? ''));
  assert.equal(out.refusal, undefined);
  assert.deepEqual(members(out.state), [[b2, a2], [b1, a1]]);
  assert.equal(out.state.players[b2 ?? '']?.teamId, 'red');
  assert.equal(out.state.players[a1 ?? '']?.teamId, 'blue');
  assert.deepEqual(out.logs, [{
    event: 'playersSwapped',
    fields: {
      a: a1, b: b2, teamA: 'red', teamB: 'blue', by: 'h',
    },
  }]);
});

test('swapping a team member with an unassigned player moves the newcomer in', () => {
  const state = twoTeams();
  const [a1] = state.teams[0]?.members ?? [];
  const out = reduce(state, swap('e', a1 ?? ''));
  assert.equal(out.state.teams[0]?.members[0], 'e');
  assert.equal(out.state.players.e?.teamId, 'red');
  assert.equal(out.state.players[a1 ?? '']?.teamId, undefined);
});

test('swaps that would change nothing or break the rules are refused', () => {
  const state = twoTeams();
  const [a1, a2] = state.teams[0]?.members ?? [];
  assert.equal(reduce(state, swap(a1 ?? '', a2 ?? '')).refusal, 'sameTeam');
  assert.equal(reduce(state, swap(a1 ?? '', a1 ?? '')).refusal, 'samePlayer');
  assert.equal(reduce(state, swap('e', 'e')).refusal, 'samePlayer');
  assert.equal(reduce(state, swap('e', 'h')).refusal, 'notOnTeam');
  assert.equal(reduce(state, swap('zz', a1 ?? '')).refusal, 'unknownPlayer');
  assert.equal(reduce(state, swap('h', a1 ?? '')).refusal, 'hostNotRacing');
});

test('swap candidates list team members in order, then unassigned online racers', () => {
  const state = twoTeams();
  const order = members(state).flat();
  assert.deepEqual(swapCandidates(state, ['h', 'e', ...order]), [...order, 'e']);
  const racing = { ...state, settings: { ...state.settings, hostRaces: true } };
  assert.deepEqual(swapCandidates(racing, ['h', 'e']), [...order, 'h', 'e']);
});

test('the view lists each team in its colour, then who is not on a team', () => {
  const { state } = reduce(hosted(), {
    type: 'autoAssignTeams', by: 'h', players: online('a', 'b', 'c', 'd'), seed: 7,
  });
  const view = teamsView(state, ['e', 'h']);
  const names = (ids: string[]) => ids.map((id) => NAMES[id]).join(', ');
  const [red, blue] = members(state) as [string[], string[]];
  assert.equal(view, `§cRed§r: ${names(red)}\n§9Blue§r: ${names(blue)}\nNot on a team: Eve`);
});

test('the view warns when fewer than 2 teams exist', () => {
  assert.equal(teamsView(hosted(), []), 'No teams yet.\nAt least 2 teams are needed to race.');
});

test('the Roadblock cap is ceil(total Roadblocks / team size)', () => {
  assert.equal(roadblockCap(6, 2), 3);
  assert.equal(roadblockCap(6, 4), 2);
  assert.equal(roadblockCap(5, 3), 2);
  assert.equal(roadblockCap(12, 1), 12);
});

test('a player at the cap may not perform unless every teammate is at the cap', () => {
  const team = { members: ['a', 'b'], roadblockCounts: { a: 3 } };
  assert.equal(mayPerform(team, 'a', 3), false);
  assert.equal(mayPerform(team, 'b', 3), true);
  assert.equal(mayPerform({ ...team, roadblockCounts: { a: 3, b: 3 } }, 'a', 3), true);
});

test('a team\'s cap uses its own member count, so smaller teams share the load', () => {
  assert.equal(roadblockCapFor({ members: ['a', 'b', 'c'] }, 6), 2);
  assert.equal(roadblockCapFor({ members: ['a', 'b'] }, 6), 3);
});
