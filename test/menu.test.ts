// Using an item is routed by item, sneaking and host role (spec §3); the host menu shows only
// the buttons valid in the current phase (spec §4), and says so when the save is unreadable.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ITEM, PASSPORT, RACE_CONTROL, TEAM_COLORS,
} from '../src/core/config.js';
import {
  HOST_ENTRIES, hostMenu, passportMenu, PHASE_LABEL, routeUse, teamsMenu, UNREADABLE_TEXT,
} from '../src/core/menu.js';
import { createState } from '../src/core/state.js';

import type { HeldItem } from '../src/core/items.js';
import type { Phase, State, Team } from '../src/core/types.js';

const item = (typeId: string, nameTag?: string, lore: readonly string[] = []): HeldItem => ({
  typeId, nameTag, lore,
});
const raceControl = item(ITEM.clock, RACE_CONTROL.nameTag, RACE_CONTROL.lore);
const passport = item(ITEM.compass, PASSPORT.nameTag, PASSPORT.lore);
const plainClock = item(ITEM.clock);
const hosted: State = { ...createState(1), hostId: 'h', players: { h: { name: 'Hana' } } };
const use = (held: HeldItem, player: string, sneaking = false) => ({
  held, player, sneaking,
});

test('the host using Race Control opens the host menu', () => {
  assert.deepEqual(routeUse(use(raceControl, 'h'), hosted), { kind: 'hostMenu' });
  assert.deepEqual(routeUse(use(raceControl, 'h', true), hosted), { kind: 'hostMenu' });
});

test('a non-host using Race Control is told it belongs to the host', () => {
  const route = routeUse(use(raceControl, 'b'), hosted);
  assert.equal(route?.kind, 'say');
  assert.match(route?.kind === 'say' ? route.text : '', /Hana/);
});

test('sneak-using any clock claims or replaces; a non-sneaking plain clock does nothing', () => {
  assert.deepEqual(routeUse(use(plainClock, 'h', true), hosted), { kind: 'claimHost' });
  assert.deepEqual(routeUse(use(plainClock, 'b', true), hosted), { kind: 'claimHost' });
  assert.deepEqual(routeUse(use(raceControl, 'b', true), createState(1)), { kind: 'claimHost' });
  assert.equal(routeUse(use(plainClock, 'h'), hosted), undefined);
});

test('the Passport opens the racer menu; other items are ignored', () => {
  assert.deepEqual(routeUse(use(passport, 'b'), hosted), { kind: 'passport' });
  assert.equal(routeUse(use(item(ITEM.compass), 'b'), hosted), undefined);
});

test('with an unreadable save, Race Control and sneak-clock open the host menu to say so', () => {
  assert.deepEqual(routeUse(use(raceControl, 'b'), undefined), { kind: 'hostMenu' });
  assert.deepEqual(routeUse(use(plainClock, 'b', true), undefined), { kind: 'hostMenu' });
  assert.equal(routeUse(use(passport, 'b'), undefined), undefined);
  const menu = hostMenu(undefined);
  assert.equal(menu.body, UNREADABLE_TEXT);
  assert.deepEqual(menu.buttons, []);
});

test('the host menu lists only entries valid in the current phase', () => {
  for (const phase of Object.keys(PHASE_LABEL) as Phase[]) {
    const menu = hostMenu({ ...hosted, phase });
    const expected = HOST_ENTRIES
      .filter((e) => (e.phases === 'all' || e.phases.includes(phase)) && (e.when?.(hosted) ?? true))
      .map((e) => e.command);
    assert.deepEqual(menu.buttons.map((b) => b.command), expected, phase);
    assert.match(menu.body, /Phase: /);
  }
  assert.ok(hostMenu(hosted).buttons.some((b) => b.command === 'transferHost'));
});

test('the Passport shows the racer\'s team, or that they have none yet', () => {
  const team = {
    id: 't1', name: 'Red', color: TEAM_COLORS[0].code, members: ['b'],
  } as unknown as Team;
  const players = { ...hosted.players, b: { name: 'Ben', teamId: 't1' } };
  const state: State = { ...hosted, teams: [team], players };
  assert.match(passportMenu(state, 'b').body, /Team: §cRed/);
  assert.match(passportMenu(state, 'c').body, /not on a team yet/);
  assert.deepEqual(passportMenu(state, 'b').buttons, []);
});

test('Setup and landmarks are offered in setup, the course screens as far as they apply', () => {
  const offered = (phase: Phase) => hostMenu({ ...hosted, phase }).buttons.map((b) => b.command);
  assert.deepEqual(offered('setup'), [
    'setup', 'teams', 'addLandmark', 'clearLandmarks', 'generate', 'transferHost',
  ]);
  assert.deepEqual(offered('generating'), ['teams', 'transferHost']);
  assert.deepEqual(offered('ready'), [
    'teams', 'generate', 'listStops', 'discardCourse', 'transferHost',
  ]);
  assert.deepEqual(offered('running'), ['transferHost']);
});

test('before the race the host menu shows the derived plan under the phase', () => {
  assert.equal(
    hostMenu(hosted).body,
    'Phase: Setup\n6 legs · ~1,800-block radius · eliminations set by teams',
  );
  assert.equal(hostMenu({ ...hosted, phase: 'running' }).body, 'Phase: Racing');
});

test('the Teams screen shows the teams and offers auto-assign and swap', () => {
  const menu = teamsMenu(hosted, []);
  assert.equal(menu.title, 'Teams');
  assert.match(menu.body, /No teams yet/);
  assert.deepEqual(menu.buttons.map((b) => b.command), ['autoAssign', 'swap']);
});
