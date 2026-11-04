// The host's Team fixes (spec §4): add a penalty, skip the current step, go to the team and
// eliminate it. Each is a deliberate override, so it is logged with who did it.
import { advanceStep } from './advance.js';
import { owe } from './penalty.js';
import { replaceTeam, teamOf as memberTeam } from './task.js';
import { refuse, refuseUnlessHost } from '../host.js';
import { teamLabel } from './pitstop.js';
import { sidebarRows, targetStop } from '../clue.js';

import type {
  Action, Effect, Result, State, Team,
} from '../types.js';
import type { Vec3 } from '../vec.js';

type Fix = Extract<Action, { type: 'teamFix' }>;

const WHEN = ['running', 'paused', 'dayEnded'] as const;

function penalty(state: State, a: Fix, team: Team, minutes: number): Result {
  // A race minute is 1/60 of a race hour (1 race hour = 30 s).
  const owed = owe(team, minutes / 60, 'host');
  return {
    state: replaceTeam(state, owed.team),
    effects: [{
      kind: 'title',
      to: team.members,
      text: `The host added a ${minutes} minute penalty.`,
      chat: true,
    }],
    logs: [owed.log, { event: 'hostPenalty', fields: { by: a.by, team: team.id, minutes } }],
  };
}

function skip(state: State, a: Fix, team: Team): Result {
  const stop = targetStop(state, team);
  if (!stop) return refuse(state, a.by, 'noStep', 'That team has no step to skip.');
  if (stop.type === 'pit' || stop.type === 'finish') {
    return refuse(state, a.by, 'pitStep', 'The Pit Stop is not skipped: use End leg.');
  }
  const out = advanceStep(state, team, stop.id);
  return {
    ...out,
    logs: [...(out.logs ?? []), {
      event: 'hostSkip', fields: { by: a.by, team: team.id, stop: stop.id },
    }],
  };
}

function eliminate(state: State, a: Fix, team: Team): Result {
  const alive = state.teams.filter((t) => t.status !== 'eliminated');
  if (alive.length < 2) {
    return refuse(state, a.by, 'lastTeam', 'The last team cannot be eliminated: use End race.');
  }
  const {
    departAt, arrivedAt, task, performer, hold, lockoutUntil, ...rest
  } = team;
  const out: Team = { ...rest, status: 'eliminated' };
  const next: State = {
    ...replaceTeam(state, out),
    // The leg's last place is not eliminated as well in the same leg.
    leg: state.leg.phase === 'rest' ? state.leg : { ...state.leg, eliminated: true },
  };
  const effects: Effect[] = [
    { kind: 'spectate', players: team.members },
    ...team.members.map((id): Effect => ({ kind: 'takeItem', from: id, item: 'passport' })),
    { kind: 'lockMovement', players: team.members, locked: false },
    { kind: 'clearHusks', team: team.id },
    { kind: 'broadcast', text: `${teamLabel(team)} has been eliminated by the host.` },
    { kind: 'sidebar', rows: sidebarRows(next) },
  ];
  return {
    state: next,
    effects,
    logs: [{ event: 'hostEliminated', fields: { by: a.by, team: team.id, leg: team.leg } }],
  };
}

function go(state: State, a: Fix, team: Team, at: Vec3 | undefined): Result {
  if (memberTeam(state, a.by)?.status === 'racing') {
    const text = 'You are racing: leaving your team would break the rules.';
    return refuse(state, a.by, 'hostRaces', text);
  }
  if (!at) return refuse(state, a.by, 'nobodyOnline', `Nobody of ${team.name} is online.`);
  return {
    state,
    effects: [{ kind: 'teleport', players: [a.by], pos: at }],
    logs: [{ event: 'hostTeleported', fields: { by: a.by, team: team.id } }],
  };
}

export function teamFix(state: State, a: Fix): Result {
  const denied = refuseUnlessHost(state, a.by, WHEN);
  if (denied) return denied;
  const team = state.teams.find((t) => t.id === a.team);
  if (!team) return refuse(state, a.by, 'noTeam', 'That team does not exist.');
  if (team.status === 'eliminated') {
    return refuse(state, a.by, 'eliminated', `${team.name} is out.`);
  }
  switch (a.fix.kind) {
    case 'penalty':
      return a.fix.minutes > 0
        ? penalty(state, a, team, a.fix.minutes)
        : refuse(state, a.by, 'noMinutes', 'Choose at least one minute.');
    case 'skip':
      return skip(state, a, team);
    case 'eliminate':
      return eliminate(state, a, team);
    case 'goto':
      return go(state, a, team, a.fix.at);
    default: {
      const unknown: never = a.fix;
      throw new Error(`unknown fix ${JSON.stringify(unknown)}`);
    }
  }
}
