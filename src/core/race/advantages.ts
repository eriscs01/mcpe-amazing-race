// The advantages' rules as pure questions (spec §8.7): when an Express Pass is usable, who a
// U-Turn may target, and which side a U-Turned team still owes. The transitions that act on the
// answers are in taskFlow.ts and task.ts; this file imports no other race module.
import { legStops } from '../clue.js';

import type {
  State, Stop, Team, ZoneName,
} from '../types.js';

/** The pass lasts to the end of this leg (spec §8.7). */
export const expressExpiresLeg = (legs: number): number => Math.ceil(legs / 2);

/** An unexpired pass, and not the final leg. */
export function expressUsable(state: State, team: Team): boolean {
  const legs = state.plan?.legs;
  return team.expressPass !== undefined && legs !== undefined
    && team.leg <= team.expressPass.expiresLeg && team.leg < legs;
}

/** Whether this team may U-Turn at this Detour: legs 2 to L−1, once per team per race. */
export function uTurnOpen(state: State, team: Team, stop: Stop): boolean {
  const legs = state.plan?.legs;
  return stop.type === 'detour' && legs !== undefined && stop.leg >= 2 && stop.leg <= legs - 1
    && !team.uTurnUsed;
}

/** Teams still racing on this leg that have not started this Detour and are not U-Turned there. */
export function uTurnTargets(state: State, team: Team, stop: Stop): Team[] {
  const index = legStops(state, stop.leg).findIndex((s) => s.id === stop.id);
  const started = (t: Team): boolean => t.task?.stopId === stop.id
    || Object.keys(t.progress).some((k) => k.startsWith(`${stop.id}:`));
  return state.teams.filter((t) => t.id !== team.id && t.status === 'racing'
    && t.leg === stop.leg && t.uTurnedAt !== stop.id && t.step <= index && !started(t));
}

/** Whether the team was U-Turned at this Detour (it must do both options). */
export const isUTurned = (team: Team, stop: Stop): boolean => team.uTurnedAt === stop.id;

export const otherSide = (side: ZoneName): ZoneName => (side === 'A' ? 'B' : 'A');
