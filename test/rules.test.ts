import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { racing } from './helpers/race.js';
import { RULES } from '../src/core/config.js';
import { reduce } from '../src/core/race/engine.js';

import type { Effect, State, Team } from '../src/core/types.js';
import type { Vec3 } from '../src/core/vec.js';

// The start line is (0, 70, 0); a 400 radius gives a warning at 600 and a stop at 700.
const course = (): State => ({
  ...racing(),
  plan: {
    legs: 2, legsPerDay: 2, radius: 400, eliminationLegs: [],
  },
  teams: racing().teams.map((t) => ({ ...t, step: 1 })),
});
const at = (x: number, z = 0, y = 70): Vec3 => ({ x, y, z });
const report = (state: State, players: { id: string; pos?: Vec3; gliding?: boolean }[]) => reduce(
  state,
  { type: 'racerPositions', players },
);
const patch = (state: State, patchOf: Partial<Team>, id = 'red'): State => ({
  ...state, teams: state.teams.map((t) => (t.id === id ? { ...t, ...patchOf } : t)),
});
const clockAt = (state: State, clock: number): State => ({ ...state, clock });
const teleports = (effects: Effect[]) => effects.flatMap((e) => (
  e.kind === 'teleport' ? [{ players: e.players, pos: e.pos }] : []));
const titles = (effects: Effect[]) => effects.flatMap((e) => (
  e.kind === 'title' ? [{ to: e.to, text: e.text.replace(/§./g, '') }] : []));
const eventsOf = (out: { logs?: { event: string }[] }) => (out.logs ?? []).map((l) => l.event);

describe('boundary (spec §9.2)', () => {
  it('records the last in-bounds position every 2 seconds', () => {
    let state = clockAt(course(), 100);
    state = report(state, [{ id: 'h', pos: at(50) }]).state;
    assert.deepEqual(state.players.h?.inBoundsPos, at(50));
    // Within 2 s: not recorded again.
    const moved = [{ id: 'h', pos: at(80) }];
    const soon = report(clockAt(state, 100 + RULES.boundary.recordTicks - 1), moved);
    assert.deepEqual(soon.state.players.h?.inBoundsPos, at(50));
    const later = report(clockAt(state, 100 + RULES.boundary.recordTicks), moved);
    assert.deepEqual(later.state.players.h?.inBoundsPos, at(80));
  });

  it('warns once, with the way back, past the warning line', () => {
    const state = clockAt(course(), 500);
    const first = report(state, [{ id: 'h', pos: at(650) }]);
    assert.equal(first.state.players.h?.outsideSince, 500);
    const [warning] = titles(first.effects);
    assert.deepEqual(warning?.to, ['h']);
    assert.match(warning?.text ?? '', /west/i);
    const again = report(clockAt(first.state, 520), [{ id: 'h', pos: at(655) }]);
    assert.deepEqual(titles(again.effects), []);
    assert.equal(again.state.players.h?.outsideSince, 500);
  });

  it('sends a racer back to the last in-bounds position 10 seconds past the line', () => {
    let { state } = report(clockAt(course(), 0), [{ id: 'h', pos: at(100, 5) }]);
    state = report(clockAt(state, 100), [{ id: 'h', pos: at(650) }]).state;
    const out = [{ id: 'h', pos: at(650) }];
    const early = report(clockAt(state, 100 + RULES.boundary.graceTicks - 1), out);
    assert.deepEqual(teleports(early.effects), []);
    const late = report(clockAt(state, 100 + RULES.boundary.graceTicks), out);
    assert.deepEqual(teleports(late.effects), [{ players: ['h'], pos: at(100, 5) }]);
    assert.equal(late.state.players.h?.outsideSince, undefined);
    assert.ok(eventsOf(late).includes('boundaryReturn'));
  });

  it('sends a racer back at once beyond the hard line', () => {
    let { state } = report(clockAt(course(), 0), [{ id: 'h', pos: at(-100) }]);
    state = clockAt(state, 40);
    const out = report(state, [{ id: 'h', pos: at(0, 701) }]);
    assert.deepEqual(teleports(out.effects), [{ players: ['h'], pos: at(-100) }]);
  });

  it('falls back to the start line when nothing was recorded', () => {
    const out = report(clockAt(course(), 10), [{ id: 'h', pos: at(0, -800) }]);
    assert.deepEqual(teleports(out.effects), [{ players: ['h'], pos: at(0) }]);
  });

  it('clears the timer when the racer comes back in time', () => {
    const out = report(clockAt(course(), 10), [{ id: 'h', pos: at(650) }]);
    const back = report(clockAt(out.state, 60), [{ id: 'h', pos: at(500) }]);
    assert.equal(back.state.players.h?.outsideSince, undefined);
  });

  it('sends a racer in another dimension back, but not on every report', () => {
    let { state } = report(clockAt(course(), 0), [{ id: 'h', pos: at(30) }]);
    state = clockAt(state, 100);
    const first = report(state, [{ id: 'h' }]);
    assert.deepEqual(teleports(first.effects), [{ players: ['h'], pos: at(30) }]);
    assert.ok(eventsOf(first).includes('dimensionReturn'));
    const next = report(clockAt(first.state, 110), [{ id: 'h' }]);
    assert.deepEqual(teleports(next.effects), []);
    const retry = report(clockAt(first.state, 100 + RULES.boundary.returnTicks), [{ id: 'h' }]);
    assert.equal(teleports(retry.effects).length, 1);
  });

  it('leaves eliminated teams, non-racers and a race that is not running alone', () => {
    const state = course();
    const out = report(state, [{ id: 'e', pos: at(900) }, { id: 'h' }]);
    assert.equal(teleports(out.effects).length, 1);
    const gone = [{ id: 'h', pos: at(900) }];
    assert.deepEqual(teleports(report(patch(state, { status: 'eliminated' }), gone).effects), []);
    assert.deepEqual(teleports(report({ ...state, phase: 'paused' }, gone).effects), []);
  });
});

describe('teammates together (spec §9.3)', () => {
  const apart = [{ id: 'h', pos: at(0) }, { id: 'b', pos: at(30) }];
  const near = [{ id: 'h', pos: at(0) }, { id: 'b', pos: at(20) }];
  const owed = (state: State) => state.teams.find((t) => t.id === 'red')?.penaltyOwed;

  it('warns at 10 seconds and charges 0.5 h at 15 seconds in a row', () => {
    const start = report(clockAt(course(), 1000), apart).state;
    assert.equal(start.teams[0]?.apartSince, 1000);
    const warn = report(clockAt(start, 1000 + RULES.separation.warnTicks), apart);
    assert.equal(titles(warn.effects).length, 1);
    assert.equal(owed(warn.state), 0);
    const again = report(clockAt(warn.state, 1000 + RULES.separation.warnTicks + 20), apart);
    assert.deepEqual(titles(again.effects), []);
    const hit = report(clockAt(warn.state, 1000 + RULES.separation.penaltyTicks), apart);
    assert.equal(owed(hit.state), 300);
    assert.ok(eventsOf(hit).includes('separationPenalty'));
    assert.equal(hit.state.teams[0]?.apartSince, undefined);
  });

  it('forgets the timer when the team comes together again', () => {
    const start = report(clockAt(course(), 0), apart).state;
    const back = report(clockAt(start, 100), near).state;
    assert.equal(back.teams[0]?.apartSince, undefined);
    assert.equal(back.teams[0]?.warnedApart, undefined);
  });

  it('waits 60 seconds after a penalty before the next timer', () => {
    const start = report(clockAt(course(), 0), apart).state;
    const hit = report(clockAt(start, RULES.separation.penaltyTicks), apart);
    const during = report(clockAt(hit.state, RULES.separation.penaltyTicks + 100), apart);
    assert.equal(during.state.teams[0]?.apartSince, undefined);
    const resumeAt = RULES.separation.penaltyTicks + RULES.separation.cooldownTicks;
    const after = report(clockAt(hit.state, resumeAt), apart);
    assert.equal(after.state.teams[0]?.apartSince, resumeAt);
  });

  it('counts only online members that report a position', () => {
    const alone = report(clockAt(course(), 0), [{ id: 'h', pos: at(0) }]);
    assert.equal(alone.state.teams[0]?.apartSince, undefined);
    const gone = report(clockAt(course(), 0), [{ id: 'h', pos: at(0) }, { id: 'b' }]);
    assert.equal(gone.state.teams[0]?.apartSince, undefined);
  });

  it('uses the nearest member: three together and one far is apart', () => {
    const state = {
      ...course(),
      players: { ...course().players, x: { name: 'Xan', teamId: 'red' } },
      teams: course().teams.map((t) => (t.id === 'red' ? { ...t, members: ['h', 'b', 'x'] } : t)),
    };
    const me = { id: 'h', pos: at(0) };
    const near3 = report(state, [me, { id: 'b', pos: at(10) }, { id: 'x', pos: at(35) }]);
    assert.equal(near3.state.teams[0]?.apartSince, 0);
    const chain = report(state, [me, { id: 'b', pos: at(20) }, { id: 'x', pos: at(40) }]);
    assert.equal(chain.state.teams[0]?.apartSince, undefined);
  });

  it('is exempt while movement is locked, and when not racing', () => {
    const locked = patch(course(), { departAt: 5000 });
    assert.equal(report(locked, apart).state.teams[0]?.apartSince, undefined);
    const mat = patch(course(), { arrivedAt: 5 });
    assert.equal(report(mat, apart).state.teams[0]?.apartSince, undefined);
    const done = patch(course(), { status: 'checkedIn' });
    assert.equal(report(done, apart).state.teams[0]?.apartSince, undefined);
  });

  it('is exempt for 30 seconds after a teammate spawns (death or rejoin)', () => {
    const state = clockAt(course(), 1000);
    const spawned = reduce(state, {
      type: 'playerSpawned', player: 'b', name: 'Ben', initial: false, hasPassport: true,
    }).state;
    assert.equal(spawned.teams[0]?.separationResumeAt, 1000 + RULES.separation.exemptTicks);
    const during = report(clockAt(spawned, 1100), apart);
    assert.equal(during.state.teams[0]?.apartSince, undefined);
    const after = report(clockAt(spawned, 1000 + RULES.separation.exemptTicks), apart);
    assert.equal(after.state.teams[0]?.apartSince, 1000 + RULES.separation.exemptTicks);
  });

  describe('during a Roadblock', () => {
    // Stop 3 is a roadblock at (300, 70, -30); Hana performs and Ben waits.
    const road = (): State => {
      const state = course();
      return {
        ...state,
        teams: state.teams.map((t) => (t.id === 'red'
          ? {
            ...t, step: 2, performer: 'h', task: { stopId: 3, option: 'A' as const },
          } : t)),
      };
    };
    const stop = at(300, -30);
    const far = [{ id: 'h', pos: at(300 + 9, -30) }, { id: 'b', pos: at(300 + 38, -30) }];

    it('lets non-performers wait within 40 blocks of the stop', () => {
      assert.equal(report(road(), far).state.teams[0]?.apartSince, undefined);
    });

    it('does not exempt a non-performer beyond 40 blocks', () => {
      const out = report(road(), [{ id: 'h', pos: stop }, { id: 'b', pos: at(300 + 45, -30) }]);
      assert.equal(out.state.teams[0]?.apartSince, 0);
    });

    it('does not exempt a team that has not started the Roadblock', () => {
      const idle = patch(road(), { task: undefined, performer: undefined });
      assert.equal(report(idle, far).state.teams[0]?.apartSince, 0);
    });
  });
});

describe('gliding (spec §9.4)', () => {
  const glide = [{ id: 'h', pos: at(0), gliding: true }];
  const owed = (state: State) => state.teams.find((t) => t.id === 'red')?.penaltyOwed;

  it('charges 0.5 h once per leg', () => {
    const first = report(course(), glide);
    assert.equal(owed(first.state), 300);
    assert.equal(first.state.teams[0]?.glidedLeg, 1);
    assert.ok(eventsOf(first).includes('glidePenalty'));
    assert.equal(titles(first.effects).length, 1);
    const second = report(first.state, glide);
    assert.equal(owed(second.state), 300);
  });

  it('charges again on the next leg', () => {
    const first = report(course(), glide).state;
    const next = { ...patch(first, { leg: 2 }), leg: { n: 2, phase: 'racing' as const } };
    assert.equal(owed(report(next, glide).state), 600);
  });

  it('ignores a racer who is not gliding or is not racing', () => {
    assert.equal(owed(report(course(), [{ id: 'h', pos: at(0) }]).state), 0);
    const out = report(course(), [{ id: 'e', pos: at(0), gliding: true }]);
    assert.equal(owed(out.state), 0);
  });
});

describe('timers live in the state (spec §9.2, §9.3)', () => {
  it('keeps the last in-bounds position while the racer is outside the line', () => {
    const inside = report(clockAt(course(), 0), [{ id: 'h', pos: at(100) }]).state;
    const outside = report(clockAt(inside, 200), [{ id: 'h', pos: at(650) }]).state;
    assert.deepEqual(outside.players.h?.inBoundsPos, at(100));
  });

  it('returns from another dimension to the recorded position, not the start', () => {
    const inside = report(clockAt(course(), 0), [{ id: 'h', pos: at(100) }]).state;
    const out = report(clockAt(inside, 100), [{ id: 'h' }]);
    assert.deepEqual(teleports(out.effects), [{ players: ['h'], pos: at(100) }]);
  });

  it('pauses a running separation timer when a teammate spawns', () => {
    const apart = [{ id: 'h', pos: at(0) }, { id: 'b', pos: at(30) }];
    const started = report(clockAt(course(), 100), apart).state;
    assert.equal(started.teams[0]?.apartSince, 100);
    const spawned = reduce(started, {
      type: 'playerSpawned', player: 'b', name: 'Ben', initial: false, hasPassport: true,
    }).state;
    assert.equal(spawned.teams[0]?.apartSince, undefined);
  });

  it('does not count a paused race, and survives a save and a reload', () => {
    const apart = [{ id: 'h', pos: at(0) }, { id: 'b', pos: at(30) }];
    const started = report(clockAt(course(), 100), apart).state;
    const paused = report({ ...clockAt(started, 5000), phase: 'paused' }, apart);
    assert.equal(paused.state.teams[0]?.apartSince, 100);
    assert.deepEqual(titles(paused.effects), []);
    const reloaded = JSON.parse(JSON.stringify(started)) as State;
    const later = report(clockAt(reloaded, 100 + RULES.separation.warnTicks), apart);
    assert.equal(titles(later.effects).length, 1);
  });
});
