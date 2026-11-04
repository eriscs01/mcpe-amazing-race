// The race's sessions (spec §11): pause, ending a day (by the host, or on its own once the day's
// planned legs are done), resuming it, and the reminder when the day's minutes have passed.
import { matCentre } from '../clue.js';
import { RACE, TICKS_PER_SECOND } from '../config.js';
import { refuseUnlessHost } from '../host.js';
import { lockedPlayers } from './locks.js';

import type {
  Action, Effect, PlayerId, Result, State, Team,
} from '../types.js';
import type { Vec3 } from '../vec.js';

type Of<T extends Action['type']> = Extract<Action, { type: T }>;

const same = (state: State): Result => ({ state, effects: [] });
const alive = (state: State): Team[] => state.teams.filter((t) => t.status !== 'eliminated');
const racersOf = (state: State): PlayerId[] => alive(state).flatMap((t) => t.members);

/** Locks `locked` and frees the other racers: the one place that says who may move. */
function locks(state: State, locked: readonly PlayerId[]): Effect[] {
  const free = racersOf(state).filter((id) => !locked.includes(id));
  return [
    ...(locked.length > 0
      ? [{ kind: 'lockMovement' as const, players: [...locked], locked: true }] : []),
    ...(free.length > 0 ? [{ kind: 'lockMovement' as const, players: free, locked: false }] : []),
  ];
}

/** Host: freezes the clock, the racers and the daylight (spec §11). */
export function pauseRace(state: State, a: Of<'pauseRace'>): Result {
  const denied = refuseUnlessHost(state, a.by, ['running']);
  if (denied) return denied;
  return {
    state: { ...state, phase: 'paused' },
    effects: [
      { kind: 'lockMovement', players: racersOf(state), locked: true },
      { kind: 'daylight', running: false },
    ],
    logs: [{ event: 'racePaused', fields: { by: a.by } }],
  };
}

/** Host: the race goes on; whoever a countdown or the mat holds stays locked. */
export function unpauseRace(state: State, a: Of<'unpauseRace'>): Result {
  const denied = refuseUnlessHost(state, a.by, ['paused']);
  if (denied) return denied;
  const next: State = { ...state, phase: 'running' };
  return {
    state: next,
    effects: [
      ...locks(next, lockedPlayers(next)),
      { kind: 'daylight', running: state.settings.daylightCycle },
    ],
    logs: [{ event: 'raceUnpaused', fields: { by: a.by } }],
  };
}

/**
 * The day ends: each online racer's position is kept (an old one is dropped), the daylight stops
 * and its time is saved, and only the countdown and the mat keep anyone locked.
 */
function closeDay(
  state: State,
  positions: readonly { id: PlayerId; pos?: Vec3 }[],
  text: string,
  by?: PlayerId,
): Result {
  const players = { ...state.players };
  racersOf(state).forEach((id) => {
    const { savedPos, ...rest } = players[id] ?? { name: id };
    const pos = positions.find((p) => p.id === id)?.pos;
    players[id] = pos ? { ...rest, savedPos: pos } : rest;
  });
  const next: State = { ...state, phase: 'dayEnded', players };
  return {
    state: next,
    effects: [
      { kind: 'daylight', running: false, save: true },
      ...locks(next, lockedPlayers(next)),
      { kind: 'broadcast', text },
    ],
    logs: [{ event: 'dayEnded', fields: { day: state.day, leg: state.leg.n, by } }],
  };
}

export function endDay(state: State, a: Of<'endDay'>): Result {
  const denied = refuseUnlessHost(state, a.by, ['running', 'paused']);
  if (denied) return denied;
  return closeDay(state, a.positions, `Day ${state.day} ended by the host. See you next session.`, a.by);
}

/** The time of day, read once the daylight stopped; kept for the resume. */
export function dayTimeSaved(state: State, a: Of<'dayTimeSaved'>): Result {
  return state.phase === 'dayEnded' ? same({ ...state, dayTime: a.time }) : same(state);
}

/**
 * After a Pit Stop's rest, once the day's planned legs are done, the day ends on its own (spec
 * §11); it never ends mid-leg and the last day has no end but the race's.
 */
export function autoEndDay(state: State): Result {
  const { plan } = state;
  if (state.phase !== 'running' || state.leg.phase !== 'rest' || !plan) return same(state);
  if (state.day >= state.settings.days) return same(state);
  if (state.leg.n - (state.dayStartLeg ?? 1) < plan.legsPerDay) return same(state);
  return closeDay(state, [], `Day ${state.day} complete — see you next session`);
}

/** Once a day, when the day's minutes have passed in the race clock, the host is reminded. */
export function remind(state: State): Result {
  const { hostId } = state;
  if (state.phase !== 'running' || !hostId || state.remindedDay === state.day) return same(state);
  const limit = state.settings.minutesPerDay * 60 * TICKS_PER_SECOND;
  if (state.clock - state.dayStartClock < limit) return same(state);
  return {
    state: { ...state, remindedDay: state.day },
    effects: [{
      kind: 'notify',
      to: hostId,
      code: 'dayMinutes',
      text: `Day ${state.day}: ${state.settings.minutesPerDay} minutes have passed. `
        + 'End the day from Race Control when you are ready.',
    }],
    logs: [{ event: 'dayReminded', fields: { day: state.day } }],
  };
}

/** Where a team stands at the Pit Stop it last cleared. */
const matOf = (state: State, team: Team): Vec3 | undefined => {
  const stop = state.stops.find((s) => s.id === team.lastClearedStop);
  return stop ? matCentre(stop) : undefined;
};

/** At the Pit Stop waiting out the rest or its departure, not in a resume countdown. */
const atPit = (t: Team): boolean => t.departAt !== undefined && t.hold === undefined;

/** Teams out on the course with no wait to serve: they go back where they stood. */
const midLeg = (t: Team): boolean => t.status === 'racing' && t.arrivedAt === undefined
  && !atPit(t);

/**
 * Host: the day goes on (spec §11). A team waiting at a Pit Stop is put on its mat and its
 * departures go on as planned; one out on the course is put where it stood and held for 10 s.
 */
export function resumeDay(state: State, a: Of<'resumeDay'>): Result {
  const denied = refuseUnlessHost(state, a.by, ['dayEnded']);
  if (denied) return denied;
  const departAt = state.clock + RACE.resumeTicks;
  const moves: Effect[] = [];
  const teams = state.teams.map((t): Team => {
    if (t.status === 'eliminated') return t;
    const mat = matOf(state, t);
    if (atPit(t)) {
      if (mat) moves.push({ kind: 'teleport', players: t.members, pos: mat });
      return t;
    }
    t.members.forEach((id) => {
      const pos = state.players[id]?.savedPos ?? mat;
      if (pos) moves.push({ kind: 'teleport', players: [id], pos });
    });
    return midLeg(t) ? { ...t, departAt, hold: 'resume' } : t;
  });
  const next: State = {
    ...state,
    phase: 'running',
    day: state.day + 1,
    dayStartClock: state.clock,
    dayStartLeg: state.leg.n,
    teams,
  };
  const { dayTime, ...kept } = next;
  return {
    state: kept,
    effects: [
      { kind: 'daylight', running: state.settings.daylightCycle, time: dayTime },
      ...moves,
      ...locks(kept, lockedPlayers(kept)),
      { kind: 'broadcast', text: `Day ${next.day} begins.` },
    ],
    logs: [{ event: 'dayResumed', fields: { day: next.day, leg: next.leg.n, by: a.by } }],
  };
}
