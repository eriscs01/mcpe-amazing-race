// Host role rules (spec §3): first spawn claims, sneak-using a plain clock claims or replaces,
// /scriptevent race:host always claims, and the host can hand the role to another player.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { reduce } from '../src/core/race/engine.js';
import { createState } from '../src/core/state.js';

import type { Effect, State } from '../src/core/types.js';

const fresh = (): State => createState(1);
const withHost = (id = 'h', name = 'Hana'): State => ({
  ...fresh(), hostId: id, players: { [id]: { name } },
});
const kinds = (effects: Effect[]) => effects.map((e) => `${e.kind}:${'to' in e ? e.to : e.from}`);

type SpawnFlags = Partial<{ initial: boolean; hasPassport: boolean }>;
const spawn = (player: string, name: string, extra: SpawnFlags = {}) => ({
  type: 'playerSpawned' as const, player, name, initial: true, hasPassport: false, ...extra,
});

test('the first player to spawn with no host stored becomes host and gets Race Control', () => {
  const out = reduce(fresh(), spawn('a', 'Ana'));
  assert.equal(out.state.hostId, 'a');
  assert.equal(out.state.players.a?.name, 'Ana');
  assert.deepEqual(out.effects[0], { kind: 'giveItem', to: 'a', item: 'raceControl' });
  assert.equal(out.effects[1]?.kind, 'notify');
});

test('later spawns only record the player; the host is unchanged and nothing is given', () => {
  const out = reduce(withHost(), spawn('b', 'Ben'));
  assert.equal(out.state.hostId, 'h');
  assert.equal(out.state.players.b?.name, 'Ben');
  assert.deepEqual(out.effects, []);
});

test('a spawn with an unchanged name and a host stored changes nothing', () => {
  const state = withHost();
  assert.equal(reduce(state, spawn('h', 'Hana')).state, state);
});

test('a racer rejoining a running race gets a Passport only if it is missing', () => {
  const base = withHost();
  const players = { ...base.players, b: { name: 'Ben', teamId: 't1' } };
  const state: State = { ...base, phase: 'paused', players };
  assert.deepEqual(kinds(reduce(state, spawn('b', 'Ben')).effects), ['giveItem:b']);
  assert.deepEqual(reduce(state, spawn('b', 'Ben', { hasPassport: true })).effects, []);
  assert.deepEqual(reduce(state, spawn('b', 'Ben', { initial: false })).effects, []);
  assert.deepEqual(reduce({ ...state, phase: 'setup' }, spawn('b', 'Ben')).effects, []);
  assert.deepEqual(reduce(state, spawn('c', 'Cy')).effects, []);
});

test('sneak-using a plain clock with no host claims the role', () => {
  const out = reduce(fresh(), {
    type: 'claimHost', by: 'a', name: 'Ana', via: 'clock',
  });
  assert.equal(out.state.hostId, 'a');
  assert.deepEqual(kinds(out.effects), ['giveItem:a', 'notify:a']);
});

test('the host sneak-using a plain clock gets a fresh Race Control in place of the old one', () => {
  const out = reduce(withHost(), {
    type: 'claimHost', by: 'h', name: 'Hana', via: 'clock',
  });
  assert.equal(out.refusal, undefined);
  assert.equal(out.state.hostId, 'h');
  assert.deepEqual(kinds(out.effects), ['takeItem:h', 'giveItem:h', 'notify:h']);
});

test('another player sneak-using a clock is refused and told who the host is', () => {
  const state = withHost();
  const out = reduce(state, {
    type: 'claimHost', by: 'b', name: 'Ben', via: 'clock',
  });
  assert.equal(out.refusal, 'notHost');
  assert.equal(out.state, state);
  const note = out.effects[0];
  assert.equal(note?.kind, 'notify');
  assert.match(note?.kind === 'notify' ? note.text : '', /Hana/);
});

test('/scriptevent race:host takes the role from the current host', () => {
  const out = reduce(withHost(), {
    type: 'claimHost', by: 'b', name: 'Ben', via: 'command',
  });
  assert.equal(out.state.hostId, 'b');
  assert.equal(out.state.players.b?.name, 'Ben');
  assert.deepEqual(kinds(out.effects), ['takeItem:h', 'notify:h', 'giveItem:b', 'notify:b']);
});

test('the host transfers the role: the item moves and both are told', () => {
  const out = reduce(withHost(), {
    type: 'transferHost', by: 'h', to: 'b', toName: 'Ben',
  });
  assert.equal(out.state.hostId, 'b');
  assert.equal(out.state.players.b?.name, 'Ben');
  assert.deepEqual(kinds(out.effects), ['takeItem:h', 'notify:h', 'giveItem:b', 'notify:b']);
});

test('only the host can transfer, and not to themselves', () => {
  const state = withHost();
  const notHost = reduce(state, {
    type: 'transferHost', by: 'b', to: 'c', toName: 'Cy',
  });
  assert.equal(notHost.refusal, 'notHost');
  assert.equal(notHost.state, state);
  const self = reduce(state, {
    type: 'transferHost', by: 'h', to: 'h', toName: 'Hana',
  });
  assert.equal(self.refusal, 'alreadyHost');
  assert.equal(self.state, state);
  assert.deepEqual(kinds(self.effects), ['notify:h']);
});
