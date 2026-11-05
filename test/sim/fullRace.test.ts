// The full-race simulation (spec §14 item 3, technical design §2.9): 9 players in 3 teams of
// three, 3 days, flat terrain. Scripted teams play every leg through the real Session and core;
// the checks below are the ones the spec lists, each made to happen on purpose.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FakeWorld, HOST, TIME_OF_DAY } from './fakeWorld.js';
import { Bot } from './players.js';

import type { Plan } from './players.js';
import type { Settings, State, Team } from '../../src/core/types.js';

const SETTINGS: Settings = {
  days: 3, minutesPerDay: 60, teamSize: 3, hostRaces: true, daylightCycle: true,
};

const GAP = 20;

/** The race past its start countdown: every team free to move. */
async function started(players: number): Promise<{ w: FakeWorld; bots: Bot[] }> {
  const w = new FakeWorld();
  await w.begin(players, SETTINGS);
  w.until(() => w.locked.size === 0, 400, 'the start countdown');
  return { w, bots: w.state.teams.map((t) => new Bot(w, t.id)) };
}

/** Everyone out of the rest or departure lock, the leg racing. */
const departed = (w: FakeWorld): void => {
  w.until(() => w.state.leg.phase === 'racing' && w.locked.size === 0, 3000, 'the departure');
};

type Plans = Record<number, Plan>;

/** Plays a team's stops up to (not including) `stopId`. */
function playUntil(bot: Bot, stopId: number, plans: Plans = {}): void {
  while (bot.target.id !== stopId) bot.play(plans[bot.target.id]);
}

/** Plays a team's stops up to its Pit Stop or Finish. */
function playToPit(bot: Bot, plans: Plans = {}): void {
  while (bot.target.type !== 'pit' && bot.target.type !== 'finish') {
    bot.play(plans[bot.target.id]);
  }
}

/** Teams arrive at the mat in `order`, `GAP` ticks apart; returns once the leg has ended. */
function arrive(w: FakeWorld, bots: Bot[], order: string[]): void {
  const leg = w.state.leg.n;
  order.forEach((id) => {
    const bot = bots.find((b) => b.id === id);
    if (!bot) throw new Error(`no bot ${id}`);
    bot.toMat();
    w.tick(GAP);
  });
  w.until(() => w.state.leg.n !== leg || w.state.leg.phase !== 'racing', 4000, `leg ${leg} to end`);
}

const team = (w: FakeWorld, id: string): Team => {
  const found = w.state.teams.find((t) => t.id === id);
  if (!found) throw new Error(`no team ${id}`);
  return found;
};

type Places = Record<string, number | undefined>;

const places = (w: FakeWorld, leg: number): Places => Object.fromEntries(
  w.state.teams.map((t) => [t.id, t.checkIns.find((c) => c.leg === leg)?.place]),
);

const eliminated = (w: FakeWorld): string[] => w.state.teams
  .filter((x) => x.status === 'eliminated').map((x) => x.id);

const noOneEliminated = (w: FakeWorld): void => {
  assert.deepEqual(w.state.teams.filter((t) => t.status === 'eliminated'), []);
};

const json = (state: State): unknown => JSON.parse(JSON.stringify(state));

/** Closes and reopens the world: the saved state comes back, a running race comes back paused. */
function roundTrip(w: FakeWorld): void {
  const before = json(w.state) as State;
  w.reopen();
  const expected = before.phase === 'running' ? { ...before, phase: 'paused' } : before;
  assert.deepEqual(json(w.state), expected);
}

const memberOf = (w: FakeWorld, id: string, n: number): string => {
  const found = team(w, id).members[n];
  if (!found) throw new Error(`team ${id} has no member ${n}`);
  return found;
};

test('9 players, 3 teams, 3 days: the full race', async (t) => {
  const { w, bots } = await started(9);
  const roadblockPerformer = (id: string): Plans => ({
    3: { performer: memberOf(w, id, 0) },
    7: { performer: memberOf(w, id, 0) },
  });

  await t.test('the plan: 6 legs over 3 days, nobody is ever eliminated with 3 teams', () => {
    assert.deepEqual(w.state.plan, {
      legs: 6, legsPerDay: 2, radius: 1800, eliminationLegs: [],
    });
    assert.equal(w.state.teams.length, 3);
    assert.ok(w.state.teams.every((x) => x.members.length === 3));
  });

  await t.test('leg 1: the course plays through; the winner gets the Express Pass', () => {
    departed(w);
    bots.forEach((b) => playToPit(b, roadblockPerformer(b.id)));
    arrive(w, bots, ['red', 'blue', 'green']);
    assert.equal(w.state.leg.phase, 'rest');
    assert.deepEqual(places(w, 1), { red: 1, blue: 2, green: 3 });
    assert.equal(team(w, 'red').expressPass?.expiresLeg, 3);
    assert.equal(team(w, 'blue').expressPass, undefined);
    assert.equal(team(w, 'green').speedBump, true);
    assert.equal(w.state.players[memberOf(w, 'red', 0)]?.teamId, 'red');
    noOneEliminated(w);
  });

  await t.test('leg 2: a U-Turn lands on the chosen team, who plays both sides', () => {
    departed(w);
    const [red, blue, green] = bots;
    assert.ok(red && blue && green);
    const detour = 6;
    playUntil(red, detour, roadblockPerformer('red'));
    red.play({ uturn: 'green' });
    assert.equal(team(w, 'red').uTurnUsed, true);
    assert.equal(team(w, 'green').uTurnedAt, detour);
    assert.equal(team(w, 'blue').uTurnedAt, undefined);
    playToPit(red, roadblockPerformer('red'));
    playToPit(blue, roadblockPerformer('blue'));
    playToPit(green, roadblockPerformer('green'));
    assert.ok(team(w, 'green').progress[`${detour}:A`] && team(w, 'green').progress[`${detour}:B`]);
    arrive(w, bots, ['red', 'blue', 'green']);
    assert.deepEqual(places(w, 2), { red: 1, blue: 2, green: 3 });
    noOneEliminated(w);
  });

  await t.test('day 1 ends by itself after its two legs and its time of day is saved', () => {
    assert.equal(w.state.phase, 'dayEnded');
    assert.equal(w.state.day, 1);
    assert.equal(w.state.dayTime, TIME_OF_DAY);
    assert.ok(HOST);
  });

  await t.test('the saved day survives closing and reopening the world', () => {
    roundTrip(w);
    assert.equal(w.state.phase, 'dayEnded');
    assert.equal(w.state.dayTime, TIME_OF_DAY);
  });

  await t.test('day 2 resumes at the Pit Stops with the rest still to run', () => {
    w.send({ type: 'resumeDay', by: HOST });
    assert.equal(w.state.phase, 'running');
    assert.equal(w.state.day, 2);
    assert.equal(w.state.dayTime, undefined);
    assert.ok(w.effects.some((e) => e.kind === 'daylight' && e.time === TIME_OF_DAY));
    assert.ok(w.state.teams.every((x) => x.hold === undefined));
    departed(w);
  });

  await t.test('leg 3: Roadblock caps, a live Express Pass, a quit penalty checks in last', () => {
    const [red, blue, green] = bots;
    assert.ok(red && blue && green);
    // Every team did the Roadblock twice with its first member: the cap of 2 (6 Roadblocks / 3).
    playUntil(red, 10);
    red.click();
    assert.ok(red.buttons().some((b) => b.type === 'expressPass'), 'the pass is valid in leg 3');
    playUntil(red, 11);
    red.click();
    const offered = red.buttons().flatMap((b) => (b.type === 'perform' ? [b.who] : []));
    const capped = memberOf(w, 'red', 0);
    assert.ok(offered.length > 0 && !offered.includes(capped), 'the capped member is not offered');
    const ignored = w.log.find('taskChoiceIgnored').length;
    w.dispatch({
      type: 'taskChoice',
      player: capped,
      stopId: 11,
      choice: { type: 'perform', who: capped },
      members: team(w, 'red').members.map((id) => ({ id, pos: w.players.get(id)?.pos })),
    });
    assert.equal(w.log.find('taskChoiceIgnored').length, ignored + 1);
    assert.equal(team(w, 'red').performer, undefined);
    playToPit(red);
    playToPit(blue);
    playUntil(green, 11);
    green.play({ quit: true });
    assert.equal(team(w, 'green').penaltyOwed, 4 * 600);
    playToPit(green);
    // Green reaches its mat first but owes the penalty, so it is checked in after the others.
    arrive(w, bots, ['green', 'red', 'blue']);
    const arrivedGreen = team(w, 'green').checkIns.find((c) => c.leg === 3);
    assert.deepEqual(places(w, 3), { red: 1, blue: 2, green: 3 });
    const blueIn = team(w, 'blue').checkIns.find((c) => c.leg === 3);
    assert.ok(arrivedGreen && blueIn && arrivedGreen.clock > blueIn.clock);
    noOneEliminated(w);
  });

  await t.test('day 2 ends mid-leg 4 by the host; day 3 resumes each team where it stood', () => {
    departed(w);
    const [red, blue, green] = bots;
    assert.ok(red && blue && green);
    playUntil(red, 14);
    red.click();
    assert.ok(!red.buttons().some((b) => b.type === 'expressPass'), 'the pass expired after leg 3');
    red.play();
    playUntil(blue, 15);
    playUntil(green, 14);
    const positions = w.online().map((p) => ({ id: p.id, pos: { ...p.pos } }));
    w.send({ type: 'endDay', by: HOST, positions });
    assert.equal(w.state.phase, 'dayEnded');
    positions.forEach(({ id, pos }) => assert.deepEqual(w.state.players[id]?.savedPos, pos));
    roundTrip(w);
    // The players logged out elsewhere: the saved spot is where the day resumes.
    w.stand(w.online().map((p) => p.id), { x: 0, y: 70, z: 0 });
    w.send({ type: 'resumeDay', by: HOST });
    assert.equal(w.state.day, 3);
    assert.equal(w.state.dayStartLeg, 4);
    assert.ok(w.state.teams.every((x) => x.hold === 'resume'), 'a 10 s hold on the course');
    assert.equal(w.locked.size, 9);
    positions.forEach(({ id, pos }) => assert.deepEqual(w.players.get(id)?.pos, pos));
    w.until(() => w.locked.size === 0, 400, 'the resume hold');
    assert.ok(w.state.teams.every((x) => x.hold === undefined));
  });

  await t.test('leg 4 finishes; day 3 does not end after two legs because it began mid-leg', () => {
    bots.forEach((b) => playToPit(b));
    arrive(w, bots, ['blue', 'red', 'green']);
    assert.deepEqual(places(w, 4), { red: 2, blue: 1, green: 3 });
    assert.equal(w.state.phase, 'running');
    assert.equal(w.state.leg.n, 5);
    assert.equal(w.state.day, 3);
    noOneEliminated(w);
  });

  await t.test('leg 5: pausing and reopening the world mid-leg keeps the race as it was', () => {
    departed(w);
    const [red, blue, green] = bots;
    assert.ok(red && blue && green);
    playToPit(red);
    w.send({ type: 'pauseRace', by: HOST });
    roundTrip(w);
    assert.equal(w.locked.size, 9, 'a paused race holds every racer');
    w.send({ type: 'unpauseRace', by: HOST });
    assert.equal(w.locked.size, 0);
    playToPit(blue);
    playToPit(green);
    arrive(w, bots, ['green', 'blue', 'red']);
    assert.deepEqual(places(w, 5), { red: 3, blue: 2, green: 1 });
    assert.equal(w.state.phase, 'running', 'the last day never ends by itself');
    assert.equal(w.state.leg.n, 6);
    noOneEliminated(w);
  });

  await t.test('leg 6 and the finish: the first team on the mat wins and the race ends', () => {
    departed(w);
    bots.forEach((b) => playToPit(b));
    const order = ['blue', 'red', 'green'];
    order.forEach((id) => {
      bots.find((b) => b.id === id)?.toMat();
      w.tick(GAP);
    });
    w.until(() => w.state.phase === 'finished', 3000, 'the finish');
    assert.equal(w.state.winner, 'blue');
    assert.deepEqual(places(w, 6), { red: 2, blue: 1, green: 3 });
    noOneEliminated(w);
  });

  await t.test('the finished race is saved and loads as it was', () => {
    roundTrip(w);
    assert.equal(w.state.phase, 'finished');
    assert.equal(w.state.winner, 'blue');
  });
});

test('12 players, 4 teams, 3 days: leg 5 eliminates the last team', async (t) => {
  const { w, bots } = await started(12);
  const alive = (): Bot[] => bots.filter((b) => team(w, b.id).status !== 'eliminated');
  const nextLeg = (plans: (id: string) => Plans = () => ({})): void => {
    if (w.state.phase === 'dayEnded') w.send({ type: 'resumeDay', by: HOST });
    departed(w);
    alive().forEach((b) => playToPit(b, plans(b.id)));
  };

  await t.test('the plan eliminates one team, on leg 5', () => {
    assert.equal(w.state.teams.length, 4);
    assert.deepEqual(w.state.plan?.eliminationLegs, [5]);
  });

  await t.test('legs 1 to 4: the Express Pass skips a Detour; nobody is eliminated', () => {
    nextLeg();
    arrive(w, bots, ['red', 'blue', 'green', 'gold']);
    const winner = team(w, 'red');
    assert.deepEqual(winner.expressPass, { expiresLeg: 3 });
    nextLeg((id): Plans => (id === 'red' ? { 6: { express: true } } : {}));
    assert.equal(team(w, 'red').expressPass, undefined, 'the pass is spent');
    assert.equal(team(w, 'red').progress['6:A'], undefined, 'the Detour was skipped, not played');
    arrive(w, bots, ['red', 'blue', 'green', 'gold']);
    nextLeg();
    arrive(w, bots, ['red', 'blue', 'green', 'gold']);
    nextLeg();
    arrive(w, bots, ['red', 'blue', 'green', 'gold']);
    noOneEliminated(w);
    assert.equal(w.state.day, 2);
  });

  await t.test('leg 5: the last team to check in is eliminated and spectates', () => {
    nextLeg();
    arrive(w, bots, ['blue', 'red', 'green', 'gold']);
    const out = w.state.teams.filter((x) => x.status === 'eliminated');
    assert.deepEqual(out.map((x) => x.id), ['gold']);
    const spectated = w.effects.filter((e) => e.kind === 'spectate').flatMap((e) => e.players);
    assert.deepEqual([...spectated].sort(), [...team(w, 'gold').members].sort());
    assert.equal(alive().length, 3);
  });

  await t.test('the final leg is raced by the three left; the first on the mat wins', () => {
    nextLeg();
    ['green', 'red', 'blue'].forEach((id) => {
      bots.find((b) => b.id === id)?.toMat();
      w.tick(GAP);
    });
    w.until(() => w.state.phase === 'finished', 3000, 'the finish');
    assert.equal(w.state.winner, 'green');
    assert.deepEqual(eliminated(w), ['gold']);
  });

  await t.test('End race restores the world and releases every player', () => {
    w.send({ type: 'endRace', by: HOST });
    assert.equal(w.state.ended, true);
    assert.ok(w.effects.some((e) => e.kind === 'restoreWorld'));
    assert.ok(w.effects.some((e) => e.kind === 'clearSidebar'));
    const reset = w.effects.filter((e) => e.kind === 'resetPlayers').flatMap((e) => e.players);
    assert.equal(new Set(reset).size, 12);
    assert.equal(w.locked.size, 0);
    roundTrip(w);
  });
});
