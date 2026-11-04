import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { at as raceAt, course } from './helpers/flow.js';
import { ARENA } from '../src/core/config.js';
import { reduce } from '../src/core/race/engine.js';
import {
  breakAllowed, sweepAreas, sweepKeep, sweepTargets,
} from '../src/core/race/protect.js';

import type { State, Stop } from '../src/core/types.js';
import type { Vec3 } from '../src/core/vec.js';

// Stop 2 is a Detour at (200, 70, -20): zone A's pile is centred at (194, 70, -20) and stands
// x 192..196, y 71..73, z -22..-18.
const lit = (state: State, ids: number[] = [2]): State => ({
  ...state,
  stops: state.stops.map((s): Stop => (ids.includes(s.id) ? { ...s, lit: true } : s)),
});
const piled = (state: State): State => ({
  ...state,
  stops: state.stops.map((s): Stop => (s.id === 2
    ? { ...s, zones: { A: { kind: 'haystack' } } } : s)),
});
const arena = (): State => piled(lit(course()));
const HAY = 'minecraft:hay_block';
const WOOL = 'minecraft:yellow_wool';
const at = (x: number, y: number, z: number) => ({ x, y, z });
const DIRT = 'minecraft:dirt';
const allowed = (state: State, player: string, pos: Vec3, block = DIRT) => breakAllowed(
  state,
  player,
  pos,
  block,
);
const eliminate = (state: State, ids?: string[]): State => ({
  ...state,
  teams: state.teams.map((t) => (!ids || ids.includes(t.id)
    ? { ...t, status: 'eliminated' as const } : t)),
});

describe('breakAllowed (spec §7.4)', () => {
  it('cancels a racer breaking an arena block', () => {
    assert.equal(allowed(arena(), 'h', at(200, 70, -20)), false);
    assert.equal(breakAllowed(arena(), 'h', at(192, 72, -25), 'minecraft:target'), false);
  });

  it('lets a racer break hay and yellow wool inside a haystack pile', () => {
    assert.equal(breakAllowed(arena(), 'h', at(194, 72, -20), HAY), true);
    assert.equal(breakAllowed(arena(), 'b', at(196, 73, -18), WOOL), true);
  });

  it('cancels hay and wool outside the pile, or in a zone that is not a haystack', () => {
    assert.equal(breakAllowed(arena(), 'h', at(197, 72, -20), HAY), false);
    assert.equal(breakAllowed(arena(), 'h', at(194, 74, -20), WOOL), false);
    assert.equal(allowed(piled(lit(course())), 'h', at(194, 72, -20)), false);
    const noZone = lit(course());
    assert.equal(breakAllowed(noZone, 'h', at(194, 72, -20), HAY), false);
  });

  it('lets a non-racer break what a racer may not only outside the pile', () => {
    assert.equal(allowed(arena(), 'e', at(200, 70, -20)), true);
    // #50: a stray break of the hidden wool would strand the pile.
    assert.equal(breakAllowed(arena(), 'e', at(194, 72, -20), WOOL), false);
    assert.equal(breakAllowed(arena(), 'e', at(194, 72, -20), HAY), false);
  });

  it('protects the footprint from below the floor to the cleared height only', () => {
    const state = arena();
    const { dirtDepth, clearHeight } = ARENA;
    assert.equal(allowed(state, 'h', at(200, 70 - dirtDepth, -20)), false);
    assert.equal(allowed(state, 'h', at(200, 70 - dirtDepth - 1, -20)), true);
    assert.equal(allowed(state, 'h', at(200, 70 + clearHeight, -20)), false);
    assert.equal(allowed(state, 'h', at(200, 70 + clearHeight + 1, -20)), true);
    assert.equal(allowed(state, 'h', at(209, 71, -20)), false);
    assert.equal(allowed(state, 'h', at(210, 71, -20)), true);
    assert.equal(allowed(state, 'h', at(200, 71, -10)), true);
  });

  it('protects only lit, built arenas while the race runs or is paused', () => {
    const unlit = piled(course());
    assert.equal(allowed(unlit, 'h', at(200, 70, -20)), true);
    const unbuilt = { ...arena(), stops: arena().stops.map((s) => ({ ...s, built: false })) };
    assert.equal(allowed(unbuilt, 'h', at(200, 70, -20)), true);
    assert.equal(allowed({ ...arena(), phase: 'paused' }, 'h', at(200, 70, -20)), false);
    assert.equal(allowed({ ...arena(), phase: 'ready' }, 'h', at(200, 70, -20)), true);
  });

  it('does not hold an eliminated team to the rule (they are spectators)', () => {
    const state = arena();
    assert.equal(allowed(eliminate(state), 'h', at(200, 70, -20)), true);
  });
});

describe('placed blocks (spec §7.4)', () => {
  const place = (state: State, player = 'h', pos = at(200, 71, -20)) => reduce(
    state,
    {
      type: 'blockPlaced', player, pos, block: 'minecraft:dirt', item: 'minecraft:dirt',
    },
  );

  it('takes a racer\'s block back inside a lit arena', () => {
    const out = place(arena());
    assert.deepEqual(out.effects, [{
      kind: 'undoPlace',
      player: 'h',
      pos: at(200, 71, -20),
      block: 'minecraft:dirt',
      item: 'minecraft:dirt',
    }]);
    assert.equal(out.logs?.[0]?.event, 'blockUndone');
  });

  it('leaves blocks outside arenas, in unlit arenas and by non-racers alone', () => {
    assert.deepEqual(place(arena(), 'h', at(260, 71, -20)).effects, []);
    assert.deepEqual(place(course()).effects, []);
    assert.deepEqual(place(arena(), 'e').effects, []);
    assert.deepEqual(place({ ...arena(), phase: 'ready' }).effects, []);
  });
});

describe('sweeps (spec §7.4, §9.4)', () => {
  it('names the lit arenas as areas while the race runs', () => {
    const areas = sweepAreas(lit(course(), [2, 3]));
    assert.equal(areas.length, 2);
    assert.deepEqual(areas[0], { min: at(191, 68, -29), max: at(209, 84, -11) });
    assert.deepEqual(sweepAreas({ ...lit(course()), phase: 'paused' }), []);
    assert.deepEqual(sweepAreas(course()), []);
  });

  it('exempts only the husks of a Hunt in play', () => {
    const hunt = { 3: { type: 'roadblock' as const, kind: 'hunt' as const } };
    const state = raceAt(2, hunt);
    const playing = {
      ...state,
      teams: state.teams.map((t) => (t.id === 'red'
        ? { ...t, performer: 'h', task: { stopId: 3, option: 'A' as const } } : t)),
    };
    assert.deepEqual(sweepKeep(playing), ['hunt:red:3:A']);
    // Quit, switched away, eliminated or moved on: the husks are no longer kept.
    assert.deepEqual(sweepKeep(state), []);
    const moved = { ...playing, teams: playing.teams.map((t) => ({ ...t, step: 3 })) };
    assert.deepEqual(sweepKeep(moved), []);
    assert.deepEqual(sweepKeep(eliminate(playing)), []);
    const other = {
      ...playing,
      teams: playing.teams.map((t) => (t.id === 'red'
        ? { ...t, task: { stopId: 3, option: 'B' as const } } : t)),
    };
    assert.deepEqual(sweepKeep(other), []);
  });

  it('sweeps every racer still in the race, only while the race runs', () => {
    assert.deepEqual(sweepTargets(course()).sort(), ['b', 'c', 'd', 'h']);
    const out = course();
    assert.deepEqual(sweepTargets(eliminate(out, ['red'])).sort(), ['c', 'd']);
    assert.deepEqual(sweepTargets({ ...out, phase: 'paused' }), []);
  });
});
