// What racers may not do (spec §9.2–9.4), decided from the adapter's position report: leaving
// the course area or the Overworld, drifting away from the team, and gliding. All timers run on
// the race clock and live in the state, so a pause or a reload does not lose or stretch them.
// Arena protection and the sweeps are protect.ts.
import { lockedPlayers } from './locks.js';
import { owe } from './penalty.js';
import { replaceTeam, teamOf } from './task.js';
import { PENALTY_HOURS, RULES } from '../config.js';
import { boundary } from '../plan.js';
import { distance, horizontalDistance } from '../vec.js';

import type {
  Action, Effect, LogLine, PlayerId, PlayerRecord, Result, State, Team,
} from '../types.js';
import type { Vec3 } from '../vec.js';

type Report = Extract<Action, { type: 'racerPositions' }>['players'][number];

const { separation: apart, boundary: bounds } = RULES;

const same = (state: State): Result => ({ state, effects: [] });

const withPlayer = (state: State, id: PlayerId, patch: Partial<PlayerRecord>): State => {
  const known = state.players[id];
  return known ? { ...state, players: { ...state.players, [id]: { ...known, ...patch } } } : state;
};

const tell = (to: PlayerId[], text: string, chat = false): Effect => ({
  kind: 'title', to, text, ...(chat ? { chat } : {}),
});

const merge = (acc: Result, out: Result): Result => ({
  state: out.state,
  effects: [...acc.effects, ...out.effects],
  logs: [...(acc.logs ?? []), ...(out.logs ?? [])],
});

const COMPASS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north',
  'north-east'];

/** The way from `from` to `to` in Bedrock axes: +X is east, +Z is south. */
export function directionTo(from: Vec3, to: Vec3): string {
  const turns = Math.atan2(to.z - from.z, to.x - from.x) / (2 * Math.PI);
  return COMPASS[(Math.round(turns * 8) + 8) % 8] ?? 'east';
}

/** A racer on a team still in the race (a spectator is not held to the rules). */
function racerOf(state: State, id: PlayerId): Team | undefined {
  const team = teamOf(state, id);
  return team && team.status !== 'eliminated' ? team : undefined;
}

// ── Boundary (spec §9.2) ────────────────────────────────────────────────────

function sendBack(state: State, id: PlayerId, to: Vec3, event: string, extra: object): Result {
  const out = withPlayer(state, id, { outsideSince: undefined });
  return {
    state: out,
    effects: [{ kind: 'teleport', players: [id], pos: to }, tell([id], 'Back to the course!')],
    logs: [{ event, fields: { player: id, clock: state.clock, ...extra } }],
  };
}

function outsideDimension(state: State, id: PlayerId, home: Vec3): Result {
  const record = state.players[id];
  const last = record?.returnedAt;
  if (last !== undefined && state.clock - last < bounds.returnTicks) return same(state);
  const marked = withPlayer(state, id, { returnedAt: state.clock });
  return sendBack(marked, id, record?.inBoundsPos ?? home, 'dimensionReturn', {});
}

function inBounds(state: State, id: PlayerId, pos: Vec3): Result {
  const record = state.players[id];
  let next = state;
  if (record?.outsideSince !== undefined) next = withPlayer(next, id, { outsideSince: undefined });
  const at = record?.inBoundsAt;
  if (at === undefined || state.clock - at >= bounds.recordTicks) {
    next = withPlayer(next, id, { inBoundsPos: pos, inBoundsAt: state.clock });
  }
  return same(next);
}

function checkBoundary(state: State, p: Report): Result {
  const { start, plan } = state;
  if (!start || !plan || !racerOf(state, p.id)) return same(state);
  if (!p.pos) return outsideDimension(state, p.id, start);
  const line = boundary(plan.radius);
  const away = horizontalDistance(p.pos, start);
  const record = state.players[p.id];
  const since = record?.outsideSince;
  const home = record?.inBoundsPos ?? start;
  if (away > line.hard || (since !== undefined && away > line.warn
    && state.clock - since >= bounds.graceTicks)) {
    return sendBack(state, p.id, home, 'boundaryReturn', { away: Math.round(away) });
  }
  if (away <= line.warn) return inBounds(state, p.id, p.pos);
  if (since !== undefined) return same(state);
  const way = directionTo(p.pos, start);
  return {
    state: withPlayer(state, p.id, { outsideSince: state.clock }),
    effects: [tell([p.id], `You are leaving the course area: head ${way}. `
      + `You will be sent back in ${bounds.graceTicks / 20} s.`, true)],
    logs: [{ event: 'boundaryWarning', fields: { player: p.id, away: Math.round(away) } }],
  };
}

// ── Teammates together (spec §9.3) ──────────────────────────────────────────

const without = (team: Team): Team => {
  const { apartSince, warnedApart, ...rest } = team;
  return rest;
};

/** No separation timer runs for `ticks` (a death or a rejoin): the team starts afresh after. */
export function pauseSeparation(state: State, teamId: string, ticks: number): State {
  const team = state.teams.find((t) => t.id === teamId);
  if (!team) return state;
  const until = Math.max(team.separationResumeAt ?? 0, state.clock + ticks);
  return replaceTeam(state, { ...without(team), separationResumeAt: until });
}

/** During a Roadblock the others wait, anywhere within 40 blocks of the stop (spec §9.3). */
function waitingAtRoadblock(state: State, team: Team, online: Report[]): boolean {
  const mine = team.task;
  const stop = mine ? state.stops.find((s) => s.id === mine.stopId) : undefined;
  if (stop?.type !== 'roadblock' || team.performer === undefined) return false;
  return online.filter((m) => m.id !== team.performer)
    .every((m) => m.pos && horizontalDistance(m.pos, stop.pos) <= apart.roadblockRadius);
}

function isApart(online: { id: PlayerId; pos: Vec3 }[]): boolean {
  return online.some((m) => online.every((o) => o.id === m.id
    || distance(m.pos, o.pos) > apart.distance));
}

function checkTeam(state: State, team: Team, a: Report[]): Result {
  const online = a.flatMap((p) => (p.pos && team.members.includes(p.id)
    ? [{ id: p.id, pos: p.pos }] : []));
  const exempt = team.status !== 'racing' || online.length < 2
    || state.clock < (team.separationResumeAt ?? 0)
    || team.members.some((m) => lockedPlayers(state).includes(m))
    || waitingAtRoadblock(state, team, online);
  if (exempt || !isApart(online)) {
    return same(team.apartSince === undefined && team.warnedApart === undefined
      ? state : replaceTeam(state, without(team)));
  }
  const since = team.apartSince ?? state.clock;
  const elapsed = state.clock - since;
  if (elapsed >= apart.penaltyTicks) {
    const owed = owe(team, PENALTY_HOURS.separation, 'separation');
    return {
      state: replaceTeam(state, {
        ...without(owed.team), separationResumeAt: state.clock + apart.cooldownTicks,
      }),
      effects: [tell(
        team.members,
        `Stay together! +${PENALTY_HOURS.separation} h, served at the Pit Stop.`,
        true,
      )],
      logs: [owed.log, { event: 'separationPenalty', fields: { team: team.id, leg: team.leg } }],
    };
  }
  const warn = elapsed >= apart.warnTicks && !team.warnedApart;
  const next: Team = { ...team, apartSince: since, ...(warn ? { warnedApart: true } : {}) };
  if (next.apartSince === team.apartSince && !warn) return same(state);
  return {
    state: replaceTeam(state, next),
    effects: warn ? [tell(
      team.members,
      `Regroup within ${(apart.penaltyTicks - elapsed) / 20} s or take a penalty.`,
    )] : [],
    logs: warn ? [{ event: 'separationWarning', fields: { team: team.id, leg: team.leg } }] : [],
  };
}

/** A racer spawned (after a death, or a join): the team's separation timers rest 30 s. */
export function spawnedRacer(state: State, a: Extract<Action, { type: 'playerSpawned' }>): Result {
  const team = state.phase === 'running' ? racerOf(state, a.player) : undefined;
  return same(team ? pauseSeparation(state, team.id, apart.exemptTicks) : state);
}

// ── Transport (spec §9.4) ───────────────────────────────────────────────────

function checkGlide(state: State, p: Report): Result {
  const team = racerOf(state, p.id);
  if (!p.gliding || team?.status !== 'racing' || team.glidedLeg === team.leg) return same(state);
  const owed = owe(team, PENALTY_HOURS.gliding, 'gliding');
  return {
    state: replaceTeam(state, { ...owed.team, glidedLeg: team.leg }),
    effects: [tell(
      team.members,
      `No elytra! +${PENALTY_HOURS.gliding} h, served at the Pit Stop.`,
      true,
    )],
    logs: [owed.log, {
      event: 'glidePenalty', fields: { team: team.id, leg: team.leg, player: p.id },
    }],
  };
}

/** The rules of spec §9 for one position report. Returns the same state when nothing changed. */
export function enforceRules(state: State, a: Extract<Action, { type: 'racerPositions' }>): Result {
  if (state.phase !== 'running') return same(state);
  const start = same(state);
  const boundaries = a.players.reduce((acc, p) => merge(acc, checkBoundary(acc.state, p)), start);
  const together = state.teams.reduce((acc, t) => {
    const team = acc.state.teams.find((x) => x.id === t.id);
    return team ? merge(acc, checkTeam(acc.state, team, a.players)) : acc;
  }, boundaries);
  return a.players.reduce((acc, p) => merge(acc, checkGlide(acc.state, p)), together);
}

export type { LogLine };
