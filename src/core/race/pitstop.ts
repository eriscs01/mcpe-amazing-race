// Pit Stop and Finish check-in (spec §8.4): arrival on the mat, the penalty countdown, placement
// by completed check-in and the leg winner's reward. Ending the leg is legEnd.ts.
import { matCentre, sidebarRows, targetStop } from '../clue.js';
import { RACE } from '../config.js';
import { horizontalDistance } from '../vec.js';

import type {
  Action, Effect, LogLine, Result, State, Team,
} from '../types.js';

type Of<T extends Action['type']> = Extract<Action, { type: T }>;

export const teamLabel = (team: Team): string => `${team.color}Team ${team.name}§r`;

/** Whether the race is on its last leg, the one that ends at the Finish. */
export const isFinalLeg = (state: State): boolean => state.plan !== undefined
  && state.leg.n >= state.plan.legs;

const replace = (state: State, team: Team): State => ({
  ...state, teams: state.teams.map((t) => (t.id === team.id ? team : t)),
});

/**
 * Completes a team's check-in now: it takes the next place, the Pit Stop counts as cleared, and
 * the leg winner is rewarded. `remaining` is the penalty it did not serve (a forced end).
 */
export function completeCheckIn(state: State, id: string, remaining = 0): Result {
  const found = state.teams.find((t) => t.id === id);
  const stop = found ? targetStop(state, found) : undefined;
  if (!found || !stop) return { state, effects: [] };
  const { arrivedAt, ...team } = found;
  const place = state.teams.filter((t) => t.checkIns.some((c) => c.leg === found.leg)).length + 1;
  const checkedIn: Team = {
    ...team,
    status: 'checkedIn',
    step: found.step + 1,
    lastClearedStop: stop.id,
    penaltyOwed: remaining,
    checkIns: [...found.checkIns, { leg: found.leg, clock: state.clock, place }],
  };
  const wins = isFinalLeg(state) && state.winner === undefined;
  const next: State = {
    ...replace(state, checkedIn),
    ...(wins ? { winner: id, finishEnd: state.clock + RACE.finishWindowTicks } : {}),
  };
  const effects: Effect[] = [
    // A team that was held on the mat is let go (a forced end locks everyone again).
    ...(arrivedAt !== undefined
      ? [{ kind: 'lockMovement' as const, players: found.members, locked: false }] : []),
    { kind: 'broadcast', text: `${teamLabel(found)} — you are team number ${place}!` },
    ...(wins ? [{
      kind: 'broadcast' as const, text: `${teamLabel(found)} wins the Amazing Race!`,
    }] : []),
    ...(place === 1 ? [{
      kind: 'reward' as const, to: found.members, levels: RACE.winnerLevels, at: matCentre(stop),
    }] : []),
    { kind: 'sidebar', rows: sidebarRows(next) },
  ];
  return {
    state: next,
    effects,
    logs: [{
      event: 'checkedIn',
      fields: {
        team: id, leg: found.leg, place, clock: state.clock,
      },
    }],
  };
}

const merge = (acc: Result, out: Result): Result => ({
  state: out.state,
  effects: [...acc.effects, ...out.effects],
  logs: [...(acc.logs ?? []), ...(out.logs ?? [])],
});

/** Online teammates all on the mat of the Pit Stop or Finish the team is heading for. */
function arrived(state: State, team: Team, players: Of<'racerPositions'>['players']): boolean {
  const stop = targetStop(state, team);
  if (!stop || (stop.type !== 'pit' && stop.type !== 'finish')) return false;
  const here = players.filter((p) => team.members.includes(p.id));
  const centre = matCentre(stop);
  // Someone in another dimension is online but not on the mat; an offline member is skipped.
  return here.length > 0
    && here.every((p) => p.pos !== undefined
      && horizontalDistance(p.pos, centre) <= RACE.matRadius);
}

/** The adapter's position report: a team standing on its mat checks in, or starts its penalty. */
export function racerPositions(state: State, a: Of<'racerPositions'>): Result {
  if (state.phase !== 'running') return { state, effects: [] };
  return state.teams.reduce<Result>((acc, original) => {
    const team = acc.state.teams.find((t) => t.id === original.id);
    const waiting = team?.status === 'racing' && team.arrivedAt === undefined
      && team.departAt === undefined && team.leg === state.leg.n;
    if (!team || !waiting || !arrived(acc.state, team, a.players)) return acc;
    if (team.penaltyOwed === 0) return merge(acc, completeCheckIn(acc.state, team.id));
    const logs: LogLine[] = [{
      event: 'arrivedOwing',
      fields: { team: team.id, leg: team.leg, owed: team.penaltyOwed },
    }];
    return merge(acc, {
      state: replace(acc.state, { ...team, arrivedAt: state.clock }),
      effects: [{ kind: 'lockMovement', players: team.members, locked: true }],
      logs,
    });
  }, { state, effects: [] });
}

/** Teams on the mat whose penalty is now served check in, in the order they finished. */
export function settlePenalties(state: State): Result {
  const due = state.teams
    .map((team, index) => ({ team, index }))
    .filter(({ team: t }) => t.status === 'racing' && t.arrivedAt !== undefined
      && state.clock >= t.arrivedAt + t.penaltyOwed)
    .sort((x, y) => (x.team.arrivedAt ?? 0) + x.team.penaltyOwed
      - ((y.team.arrivedAt ?? 0) + y.team.penaltyOwed)
      || (x.team.arrivedAt ?? 0) - (y.team.arrivedAt ?? 0) || x.index - y.index);
  return due.reduce<Result>(
    (acc, { team }) => merge(acc, completeCheckIn(acc.state, team.id)),
    { state, effects: [] },
  );
}
