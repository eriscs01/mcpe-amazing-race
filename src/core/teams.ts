// Teams (spec §4, §8.7): auto-assign, swap, the host's view, colours from the fixed list, and the
// Roadblock cap. Teams change only before the race starts; Team fixes during it come later.
import { TEAM_COLORS } from './config.js';
import {
  notify, refuse, refuseUnlessHost, withName,
} from './host.js';
import { Rng } from './rng.js';

import type {
  Action, Effect, Phase, PlayerId, PlayerRecord, Result, State, Team,
} from './types.js';

type Of<T extends Action['type']> = Extract<Action, { type: T }>;

export const TEAM_PHASES: readonly Phase[] = ['setup', 'generating', 'ready'];

const MIN_TEAMS = 2;

/** Team sizes for `players` racers: ceil(players / size) teams, as even as possible. */
export function teamSizes(players: number, size: number): number[] {
  if (players === 0) return [];
  const count = Math.ceil(players / size);
  const base = Math.floor(players / count);
  return Array.from({ length: count }, (_, i) => base + (i < players % count ? 1 : 0));
}

function newTeam(index: number, members: PlayerId[]): Team {
  const color = TEAM_COLORS[index] ?? TEAM_COLORS[0]; // callers stay within the colour list
  return {
    id: color.name.toLowerCase(),
    name: color.name,
    color: color.code,
    members,
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
  };
}

const races = (state: State, id: PlayerId): boolean => id !== state.hostId
  || state.settings.hostRaces;

const nameOf = (state: State, id: PlayerId): string => state.players[id]?.name ?? id;

const label = (team: Team): string => `${team.color}${team.name}§r`;

/** "A", "A and B", "A, B and C". */
function joined(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
}

function withTeam(record: PlayerRecord, teamId: string | undefined): PlayerRecord {
  const rest = { ...record };
  delete rest.teamId;
  return teamId === undefined ? rest : { ...rest, teamId };
}

/** Sets every known player's teamId from `teams`; anyone on no team loses theirs. */
function withTeams(state: State, teams: Team[]): State {
  const teamOf = new Map(teams.flatMap((t) => t.members.map((id) => [id, t.id] as const)));
  const players = Object.fromEntries(Object.entries(state.players)
    .map(([id, record]) => [id, withTeam(record, teamOf.get(id))]));
  return { ...state, teams, players };
}

/** Tells a racer which team they are now on, and with whom. */
function placed(state: State, id: PlayerId, code: string): Effect {
  const team = state.teams.find((t) => t.members.includes(id));
  if (!team) return notify(id, code, 'You are no longer on a team.');
  const mates = team.members.filter((m) => m !== id).map((m) => nameOf(state, m));
  const withMates = mates.length > 0 ? ` with ${joined(mates)}` : '';
  return notify(id, code, `You are on ${label(team)}${withMates}.`);
}

export function autoAssignTeams(state: State, a: Of<'autoAssignTeams'>): Result {
  const denied = refuseUnlessHost(state, a.by, TEAM_PHASES);
  if (denied) return denied;
  const racers = a.players.filter((p) => races(state, p.id)).map((p) => p.id);
  const size = state.settings.teamSize;
  const sizes = teamSizes(racers.length, size);
  if (sizes.length < MIN_TEAMS) {
    return refuse(state, a.by, 'tooFewTeams', `At least ${MIN_TEAMS} teams are needed: `
      + `${racers.length} racers online at ${size} per team.`);
  }
  if (sizes.length > TEAM_COLORS.length) {
    return refuse(state, a.by, 'tooManyTeams', `That makes ${sizes.length} teams; the most is `
      + `${TEAM_COLORS.length}. Raise Players per team in Setup.`);
  }
  const shuffled = new Rng(a.seed).shuffle(racers);
  let at = 0;
  const teams = sizes.map((n, i) => {
    at += n;
    return newTeam(i, shuffled.slice(at - n, at));
  });
  const named = a.players.reduce((s, p) => withName(s, p.id, p.name), state);
  const next = withTeams(named, teams);
  const summary = `Teams assigned: ${teams.length} teams, ${racers.length} racers.`;
  return {
    state: next,
    effects: [
      notify(a.by, 'teamsAssigned', summary),
      ...racers.map((id) => placed(next, id, 'teamsAssigned')),
    ],
    logs: [{
      event: 'teamsAssigned',
      fields: {
        teams: teams.length, racers: racers.length, sizes: sizes.join(','), seed: a.seed, by: a.by,
      },
    }],
  };
}

export function swapPlayers(state: State, a: Of<'swapPlayers'>): Result {
  const denied = refuseUnlessHost(state, a.by, TEAM_PHASES);
  if (denied) return denied;
  if (!state.players[a.a] || !state.players[a.b]) {
    return refuse(state, a.by, 'unknownPlayer', 'That player has never joined this world.');
  }
  const teamA = state.teams.find((t) => t.members.includes(a.a));
  const teamB = state.teams.find((t) => t.members.includes(a.b));
  if (a.a === a.b) return refuse(state, a.by, 'samePlayer', 'Pick two different players.');
  if (!teamA && !teamB) {
    return refuse(state, a.by, 'notOnTeam', 'Neither player is on a team.');
  }
  if (teamA === teamB) {
    return refuse(state, a.by, 'sameTeam', 'Those players are already on the same team.');
  }
  if (!races(state, a.a) || !races(state, a.b)) {
    return refuse(state, a.by, 'hostNotRacing', 'The host is not racing; turn on Host also '
      + 'races in Setup first.');
  }
  const other = (id: PlayerId): PlayerId => {
    if (id === a.a) return a.b;
    return id === a.b ? a.a : id;
  };
  const teams = state.teams.map((t) => ({ ...t, members: t.members.map(other) }));
  const next = withTeams(state, teams);
  const text = `Swapped ${nameOf(state, a.a)} and ${nameOf(state, a.b)}.`;
  return {
    state: next,
    effects: [
      notify(a.by, 'playersSwapped', text),
      placed(next, a.a, 'playersSwapped'),
      placed(next, a.b, 'playersSwapped'),
    ],
    logs: [{
      event: 'playersSwapped',
      fields: {
        a: a.a, b: a.b, teamA: teamA?.id, teamB: teamB?.id, by: a.by,
      },
    }],
  };
}

/** Racers online but on no team, in `online` order. */
function unassigned(state: State, online: readonly PlayerId[]): PlayerId[] {
  return online.filter((id) => races(state, id)
    && !state.teams.some((t) => t.members.includes(id)));
}

/** Who the Swap screen offers: team members in team order, then unassigned online racers. */
export function swapCandidates(state: State, online: readonly PlayerId[]): PlayerId[] {
  return [...state.teams.flatMap((t) => t.members), ...unassigned(state, online)];
}

/** The host's View teams text: each team in its colour, then online racers on no team. */
export function teamsView(state: State, online: readonly PlayerId[]): string {
  const lines = state.teams.map((t) => {
    const names = t.members.map((id) => nameOf(state, id)).join(', ');
    return `${label(t)}: ${names}`;
  });
  if (lines.length === 0) lines.push('No teams yet.');
  const loose = unassigned(state, online);
  if (loose.length > 0) {
    lines.push(`Not on a team: ${loose.map((id) => nameOf(state, id)).join(', ')}`);
  }
  if (state.teams.length < MIN_TEAMS) {
    lines.push(`At least ${MIN_TEAMS} teams are needed to race.`);
  }
  return lines.join('\n');
}

/** Most Roadblocks one player may perform: ceil(total Roadblocks / team size) (spec §8.7). */
export function roadblockCap(totalRoadblocks: number, teamSize: number): number {
  return Math.ceil(totalRoadblocks / Math.max(1, teamSize));
}

/** The cap for one team, by its actual member count (technical design §3). */
export function roadblockCapFor(team: Pick<Team, 'members'>, totalRoadblocks: number): number {
  return roadblockCap(totalRoadblocks, team.members.length);
}

/** Under the cap, or everyone on the team is at it (then anyone may perform). */
export function mayPerform(
  team: Pick<Team, 'members' | 'roadblockCounts'>,
  player: PlayerId,
  cap: number,
): boolean {
  const count = (id: PlayerId): number => team.roadblockCounts[id] ?? 0;
  return count(player) < cap || team.members.every((id) => count(id) >= cap);
}
