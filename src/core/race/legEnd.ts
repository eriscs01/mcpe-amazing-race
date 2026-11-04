// Ending a leg and starting the next (spec §8.5): grace for the last team, then eliminating it or
// giving it a Speed Bump, the rest, the staggered departures, and the final leg's end.
import { lightEffects } from '../arenas.js';
import {
  clueText, legStops, matCentre, sidebarRows, targetStop,
} from '../clue.js';
import { RACE, TICKS_PER_SECOND } from '../config.js';
import { refuse, refuseUnlessHost } from '../host.js';
import { chain } from './chain.js';
import { completeCheckIn, isFinalLeg, teamLabel } from './pitstop.js';

import type {
  Action, Effect, LogLine, PlayerId, Result, State, Team,
} from '../types.js';

type Of<T extends Action['type']> = Extract<Action, { type: T }>;

const same = (state: State): Result => ({ state, effects: [] });
const alive = (state: State): Team[] => state.teams.filter((t) => t.status !== 'eliminated');
const membersOf = (teams: readonly Team[]): PlayerId[] => teams.flatMap((t) => t.members);
const merge = (acc: Result, out: Result): Result => ({
  state: out.state,
  effects: [...acc.effects, ...out.effects],
  logs: [...(acc.logs ?? []), ...(out.logs ?? [])],
});
const place = (team: Team, leg: number): number => team.checkIns
  .find((c) => c.leg === leg)?.place ?? Number.POSITIVE_INFINITY;

/** Teams not yet checked in for this leg that are not eliminated. */
const waiting = (state: State): Team[] => alive(state).filter((t) => t.status === 'racing');

/** Checks in everyone not yet in: those serving a penalty (in arrival order), then the rest. */
function checkInRemaining(start: State): Result {
  const serving = start.teams
    .map((team, index) => ({ team, index }))
    .filter(({ team: t }) => t.status === 'racing' && t.arrivedAt !== undefined)
    .sort((x, y) => (x.team.arrivedAt ?? 0) - (y.team.arrivedAt ?? 0) || x.index - y.index);
  const afterServing = serving.reduce<Result>((acc, { team }) => {
    const left = Math.max(0, (team.arrivedAt ?? 0) + team.penaltyOwed - start.clock);
    return merge(acc, completeCheckIn(acc.state, team.id, { remaining: left, forced: true }));
  }, same(start));
  // Teams that never arrived rank by how far they got, then in team order.
  const stragglers = waiting(afterServing.state)
    .map((team, index) => ({ team, index }))
    .sort((x, y) => y.team.step - x.team.step || x.index - y.index)
    .map(({ team }) => team);
  const teleports: Effect[] = stragglers.flatMap((t) => {
    const stop = targetStop(afterServing.state, t);
    return stop ? [{ kind: 'teleport' as const, players: t.members, pos: matCentre(stop) }] : [];
  });
  return stragglers.reduce<Result>(
    (acc, t) => merge(acc, completeCheckIn(acc.state, t.id, {
      remaining: t.penaltyOwed, forced: true,
    })),
    { ...afterServing, effects: [...afterServing.effects, ...teleports] },
  );
}

/**
 * What a leg leaves behind does not carry into the next: a Speed Bump never done, a task left
 * half way, a U-Turn mark; and an Express Pass ends with leg ceil(L / 2) (spec §8.7).
 */
function closeAdvantages(state: State): Result {
  const leg = state.leg.n;
  const expired: LogLine[] = [];
  const teams = state.teams.map((t): Team => {
    const {
      task, performer, lockoutUntil, uTurnedAt, expressPassed, expressPass, ...rest
    } = t;
    const lapsed = expressPass !== undefined && expressPass.expiresLeg <= leg;
    if (lapsed) expired.push({ event: 'expressExpired', fields: { team: t.id, leg } });
    return { ...rest, speedBump: false, ...(expressPass && !lapsed ? { expressPass } : {}) };
  });
  return { state: { ...state, teams }, effects: [], logs: expired };
}

/** The team that checked in last gets the Speed Bump, or is out if this leg eliminates. */
function lastPlace(state: State): Result {
  const leg = state.leg.n;
  const placed = alive(state).filter((t) => t.checkIns.some((c) => c.leg === leg));
  const last = placed.reduce<Team | undefined>(
    (worst, t) => (worst === undefined || place(t, leg) > place(worst, leg) ? t : worst),
    undefined,
  );
  if (!last || placed.length < 2) return same(state);
  const swap = (t: Team): State => ({
    ...state, teams: state.teams.map((x) => (x.id === t.id ? t : x)),
  });
  if (state.plan?.eliminationLegs.includes(leg)) {
    const out = swap({ ...last, status: 'eliminated' });
    return {
      state: out,
      effects: [
        { kind: 'spectate', players: last.members },
        ...last.members.map((id): Effect => ({ kind: 'takeItem', from: id, item: 'passport' })),
        { kind: 'broadcast', text: `${teamLabel(last)} has been eliminated!` },
      ],
      logs: [{ event: 'teamEliminated', fields: { team: last.id, leg } }],
    };
  }
  return {
    state: swap({ ...last, speedBump: true }),
    effects: [{
      kind: 'broadcast', text: `${teamLabel(last)} was last and gets a Speed Bump on the next leg.`,
    }],
    logs: [{ event: 'speedBumpAssigned', fields: { team: last.id, leg } }],
  };
}

/** Moves the survivors to the next leg, rested and locked until their staggered departure. */
function startRest(state: State): Result {
  const leg = state.leg.n;
  const winner = Math.min(...state.teams.flatMap((t) => t.checkIns
    .filter((c) => c.leg === leg).map((c) => c.clock)));
  const restEnd = state.clock + RACE.restTicks;
  const departing = (t: Team): Team => {
    const clock = t.checkIns.find((c) => c.leg === leg)?.clock ?? winner;
    const gap = Math.min(clock - winner, RACE.departCapTicks);
    return {
      ...t,
      status: 'racing',
      leg: leg + 1,
      step: 0,
      penaltyOwed: 0,
      departAt: restEnd + gap + t.penaltyOwed,
    };
  };
  const teams = state.teams.map((t) => (t.status === 'checkedIn' ? departing(t) : t));
  const stops = state.stops.map((s) => ({ ...s, lit: s.leg === leg + 1 }));
  const changed = stops.filter((s, i) => s.lit !== state.stops[i]?.lit);
  const next: State = {
    ...state, teams, stops, leg: { n: leg + 1, phase: 'rest', restEnd },
  };
  const survivors = membersOf(alive(next));
  return {
    state: next,
    effects: [
      { kind: 'lockMovement', players: survivors, locked: true },
      { kind: 'restore', players: survivors },
      ...lightEffects(changed),
      { kind: 'sidebar', rows: sidebarRows(next) },
    ],
    logs: [{
      event: 'legEnded',
      fields: {
        leg, next: leg + 1, restEnd, teams: alive(next).length,
      },
    }],
  };
}

/** Ends the current (non-final) leg now: everyone is checked in, the last team is dealt with. */
const endCurrentLeg = (state: State): Result => chain(state, [
  checkInRemaining, closeAdvantages, lastPlace, startRest,
]);

/** After the rest the next leg begins: its clue goes out, and the departures start counting. */
function endRest(state: State): Result {
  if (state.leg.phase !== 'rest' || state.clock < (state.leg.restEnd ?? 0)) return same(state);
  const { n } = state.leg;
  const first = legStops(state, n)[0];
  const next: State = { ...state, leg: { n, phase: 'departing' } };
  return {
    state: next,
    effects: [
      { kind: 'broadcast', text: `Leg ${n} begins.` },
      ...(first ? alive(next).map((t): Effect => ({
        kind: 'title', to: t.members, text: clueText(next, first), chat: true,
      })) : []),
    ],
    logs: [{ event: 'legBegun', fields: { leg: n } }],
  };
}

/** Teams whose departure time has come are let go, each on its own; the last ends the countdown. */
function release(state: State): Result {
  const due = state.teams.filter((t) => t.departAt !== undefined && state.clock >= t.departAt);
  if (due.length === 0) return same(state);
  const dueIds = new Set(due.map((t) => t.id));
  const teams = state.teams.map((t): Team => {
    if (!dueIds.has(t.id)) return t;
    const { departAt, ...rest } = t;
    return rest;
  });
  const still = teams.some((t) => t.departAt !== undefined);
  const phase = state.leg.phase === 'departing' && !still ? 'racing' : state.leg.phase;
  const members = membersOf(due);
  return {
    state: { ...state, teams, leg: { ...state.leg, phase } },
    effects: [
      { kind: 'lockMovement', players: members, locked: false },
      { kind: 'title', to: members, text: 'GO!' },
    ],
    logs: [{
      event: 'raceReleased', fields: { leg: state.leg.n, teams: due.map((t) => t.id).join() },
    }],
  };
}

/** The final leg: the race ends when every team is in, or 60 seconds after the winner. */
function settleFinal(state: State): Result {
  if (state.winner === undefined) return same(state);
  if (waiting(state).length > 0 && state.clock < (state.finishEnd ?? 0)) return same(state);
  const logs: LogLine[] = [{
    event: 'raceFinished',
    fields: {
      winner: state.winner, clock: state.clock, unplaced: waiting(state).map((t) => t.id).join(),
    },
  }];
  return {
    state: { ...state, phase: 'finished' },
    effects: [
      { kind: 'lockMovement', players: membersOf(state.teams), locked: false },
      { kind: 'broadcast', text: 'The race is over!' },
      { kind: 'sidebar', rows: sidebarRows(state) },
    ],
    logs,
  };
}

/** The last team still out gets a grace period unless it is held by a penalty (spec §8.5). */
function settleGrace(state: State): Result {
  const left = waiting(state);
  const [last] = left;
  const held = last?.arrivedAt !== undefined || last?.departAt !== undefined;
  if (left.length !== 1 || alive(state).length < 2 || held || !last) {
    return state.leg.phase === 'grace'
      ? same({ ...state, leg: { n: state.leg.n, phase: 'racing' } }) : same(state);
  }
  if (state.leg.phase !== 'grace') {
    const graceEnd = state.clock + RACE.graceTicks;
    return {
      state: { ...state, leg: { n: state.leg.n, phase: 'grace', graceEnd } },
      effects: [{
        kind: 'broadcast',
        text: `${teamLabel(last)} has ${RACE.graceTicks / TICKS_PER_SECOND} seconds `
          + 'to reach the Pit Stop.',
      }],
      logs: [{ event: 'graceStarted', fields: { team: last.id, leg: state.leg.n, graceEnd } }],
    };
  }
  return state.clock >= (state.leg.graceEnd ?? 0) ? endCurrentLeg(state) : same(state);
}

/** Whether the leg is over because every team still racing has checked in. */
function settleRacing(state: State): Result {
  if (alive(state).length > 0 && waiting(state).length === 0) return endCurrentLeg(state);
  return settleGrace(state);
}

/** The leg's own progress: the final leg's end, or the others' grace and end (not in the rest). */
function settleLegProgress(state: State): Result {
  if (state.leg.phase === 'rest') return same(state);
  return isFinalLeg(state) ? settleFinal(state) : settleRacing(state);
}

/** Everything that moves a leg along on a clock tick; the penalties are served before this. */
export function settleLeg(state: State): Result {
  if (state.phase !== 'running') return same(state);
  return chain(state, [
    endRest,
    release,
    settleLegProgress,
  ]);
}

/** Whether the host's End leg applies now: a non-final leg that is not resting. */
export const canEndLeg = (state: State): boolean => state.leg.phase !== 'rest'
  && !isFinalLeg(state);

/** Host: ends the leg now (spec §8.5). */
export function endLeg(state: State, a: Of<'endLeg'>): Result {
  const denied = refuseUnlessHost(state, a.by, ['running']);
  if (denied) return denied;
  if (state.leg.phase === 'rest') {
    return refuse(state, a.by, 'notRacing', 'The teams are resting; the next leg starts soon.');
  }
  if (isFinalLeg(state)) {
    return refuse(
      state,
      a.by,
      'finalLeg',
      'The final leg ends when a team checks in at the Finish.',
    );
  }
  const ended = endCurrentLeg(state);
  const logs = [
    ...(ended.logs ?? []),
    { event: 'legEndedByHost', fields: { by: a.by, leg: state.leg.n } },
  ];
  return { ...ended, logs };
}
