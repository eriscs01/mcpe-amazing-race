// Race start (spec §8.1) and the countdown that ends it: who may start, what the start fixes in
// the state, and the effects that put racers on the line with the kit and their movement locked.
import { allArenasBuilt, lightEffects, unbuilt } from '../arenas.js';
import { clueText, legStops, sidebarRows } from '../clue.js';
import { ARENA, RACE } from '../config.js';
import { refuse, refuseUnlessHost } from '../host.js';
import { planOf } from '../plan.js';
import { lockedPlayers } from './locks.js';
import { MIN_TEAMS } from '../teams.js';

import type {
  Action, Effect, Phase, PlayerId, Result, State, Team,
} from '../types.js';
import type { Vec3 } from '../vec.js';

type Of<T extends Action['type']> = Extract<Action, { type: T }>;

export const START_PHASES: readonly Phase[] = ['ready'];
const RUN_PHASES: readonly Phase[] = ['running', 'paused', 'dayEnded'];

/** `count` spots on a ring around the start line's centre, one block above its floor. */
function ringSpots(centre: Vec3, count: number): Vec3[] {
  // Wider for a crowd, but inside the flags and torches; beyond that racers share blocks.
  const radius = Math.min(ARENA.half - 2, Math.max(RACE.ringRadius, Math.ceil(count / 3)));
  return Array.from({ length: count }, (_, i) => {
    const angle = (2 * Math.PI * i) / Math.max(1, count);
    return {
      x: Math.round(centre.x + radius * Math.cos(angle)),
      y: centre.y + 1,
      z: Math.round(centre.z + radius * Math.sin(angle)),
    };
  });
}

const raceControl = (to: PlayerId): Effect => ({ kind: 'giveItem', to, item: 'raceControl' });

const firstClues = (state: State): Effect[] => state.teams.flatMap((t) => {
  const first = legStops(state, 1)[0];
  return first ? [{
    kind: 'title' as const, to: t.members, text: clueText(state, first), chat: true,
  }] : [];
});

export function startRace(state: State, a: Of<'startRace'>): Result {
  const denied = refuseUnlessHost(state, a.by, START_PHASES);
  if (denied) return denied;
  if (state.teams.length < MIN_TEAMS) {
    return refuse(state, a.by, 'tooFewTeams', `At least ${MIN_TEAMS} teams are needed to start.`);
  }
  if (!allArenasBuilt(state)) {
    // allArenasBuilt is also false for a state with no stops at all.
    const missing = unbuilt(state).length;
    const text = missing === 0 ? 'There is no course to race.'
      : `${missing} arena${missing === 1 ? '' : 's'} still to build. Use Build arenas first.`;
    return refuse(state, a.by, 'arenasMissing', text);
  }
  const plan = planOf(state);
  const home = state.stops.find((s) => s.type === 'start') ?? state.stops[0];
  const departAt = state.clock + RACE.countdownTicks;
  const teams: Team[] = state.teams.map((t) => ({
    ...t, leg: 1, step: 0, lastClearedStop: home?.id ?? 0, departAt,
  }));
  // Whatever the debug command left lit is cleared; only leg 1 shows its beams.
  const stops = state.stops.map((s) => ({ ...s, lit: s.leg === 1 }));
  const next: State = {
    ...state,
    phase: 'running',
    plan,
    snapshot: a.snapshot,
    day: 1,
    dayStartClock: state.clock,
    leg: { n: 1, phase: 'departing' },
    teams,
    stops,
  };
  const racers = teams.flatMap((t) => t.members
    .filter((id) => a.online.includes(id))
    .map((id) => ({ id, name: state.players[id]?.name ?? id, color: t.color })));
  const spots = ringSpots(home?.pos ?? state.start ?? { x: 0, y: 64, z: 0 }, racers.length);
  const hostRaces = racers.some((r) => r.id === state.hostId);
  const effects: Effect[] = [
    {
      kind: 'startRacers',
      racers: racers.map((r, i) => ({ ...r, spawn: spots[i] ?? spots[0] as Vec3 })),
      daylight: state.settings.daylightCycle,
      time: state.settings.daylightCycle ? RACE.dayTime : RACE.fixedTime,
    },
    ...racers.map((r): Effect => ({ kind: 'giveItem', to: r.id, item: 'passport' })),
    // The clear removed the host's Race Control along with everything else.
    ...(hostRaces && state.hostId ? [raceControl(state.hostId)] : []),
    { kind: 'lockMovement', players: racers.map((r) => r.id), locked: true },
    ...lightEffects(stops),
    { kind: 'broadcast', text: `The race is on! ${teams.length} teams, ${plan.legs} legs.` },
    { kind: 'broadcast', text: 'Leg 1 begins.' },
    { kind: 'sidebar', rows: sidebarRows(next) },
    ...firstClues(next),
  ];
  return {
    state: next,
    effects,
    logs: [{
      event: 'raceStarted',
      fields: {
        by: a.by, teams: teams.length, racers: racers.length, legs: plan.legs,
      },
    }],
  };
}

/** What a reloaded world redoes: the movement lock of a countdown still running, the sidebar. */
export function raceResumeEffects(state: State): Effect[] {
  if (!RUN_PHASES.includes(state.phase)) return [];
  const locked = lockedPlayers(state);
  return [
    ...(locked.length > 0
      ? [{ kind: 'lockMovement' as const, players: locked, locked: true }] : []),
    { kind: 'sidebar', rows: sidebarRows(state) },
  ];
}
