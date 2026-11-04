// Spending an advantage at a clue box (spec §8.7): the U-Turn on a Detour's board, and the
// Express Pass on a Detour, a Roadblock or a Speed Bump. Each choice is re-checked here, since the
// menu it came from may be stale. The rules it asks are in advantages.ts.
import { advanceStep } from './advance.js';
import {
  expressUsable, isUTurned, otherSide, uTurnOpen, uTurnTargets,
} from './advantages.js';
import {
  hasTaskHere, ignored, optionMenu,
} from './flowMenus.js';
import { teamLabel } from './pitstop.js';
import {
  beginTask, eligible, offersOf, replaceTeam, sideDone,
} from './task.js';

import type { Of } from './flowMenus.js';
import type {
  Effect, Result, State, Stop, Team,
} from '../types.js';

/** A team uses its U-Turn on `choice.team` at this Detour (spec §8.7). */
export function uTurn(state: State, a: Of<'taskChoice'>, team: Team, stop: Stop): Result {
  const { choice } = a;
  if (choice.type !== 'uturn') return ignored(state, a, 'notUturn');
  const target = uTurnTargets(state, team, stop).find((t) => t.id === choice.team);
  if (!uTurnOpen(state, team, stop) || hasTaskHere(team, stop) || !target) {
    return ignored(state, a, 'noUturn');
  }
  const user: Team = { ...team, uTurnUsed: true };
  const hit: Team = { ...target, uTurnedAt: stop.id };
  const swap = (t: Team): Team => {
    if (t.id === user.id) return user;
    return t.id === hit.id ? hit : t;
  };
  const next: State = { ...state, teams: state.teams.map(swap) };
  const menu = optionMenu(next, user, stop, a.player);
  return {
    state: next,
    effects: [
      {
        kind: 'broadcast',
        text: `${teamLabel(team)} U-Turned ${teamLabel(target)} at ${stop.name}!`,
      },
      {
        kind: 'title',
        to: target.members,
        text: `${team.name} U-Turned you at ${stop.name}: you must complete both options.`,
        chat: true,
      },
      ...menu.effects,
    ],
    logs: [{
      event: 'uTurned',
      fields: {
        team: team.id, leg: team.leg, stop: stop.id, target: target.id, by: a.player,
      },
    }],
  };
}

/**
 * A team spends its Express Pass (spec §8.7): a Detour, a Roadblock or a Speed Bump is skipped;
 * on a U-Turned Detour only one side is, and the other must still be done.
 */
export function useExpressPass(
  state: State,
  a: Of<'taskChoice'>,
  team: Team,
  stop: Stop,
): Result {
  const { choice } = a;
  if (choice.type !== 'expressPass') return ignored(state, a, 'notExpress');
  if (!expressUsable(state, team)) return ignored(state, a, 'noPass');
  if (stop.type === 'route' && !team.speedBump) return ignored(state, a, 'noSpeedBump');
  if (stop.type === 'roadblock' && hasTaskHere(team, stop) && !eligible(team, stop, a.player)) {
    return ignored(state, a, 'notEligible');
  }
  const { expressPass, ...kept } = team;
  const announce: Effect = {
    kind: 'broadcast', text: `${teamLabel(team)} used the Express Pass at ${stop.name}!`,
  };
  const used = {
    event: 'expressUsed',
    fields: {
      team: team.id, leg: team.leg, stop: stop.id, type: stop.type, by: a.player,
    },
  };
  if (stop.type === 'detour' && isUTurned(team, stop)) {
    const side = choice.option ?? (hasTaskHere(team, stop) ? team.task?.option : undefined);
    const skipped = offersOf(stop).find((o) => o.option === side);
    const owed = skipped && offersOf(stop).find((o) => o.option === otherSide(skipped.option));
    if (!skipped || !owed) return ignored(state, a, 'noSide');
    const passed: Team = { ...kept, expressPassed: skipped.option };
    const moved = replaceTeam(state, passed);
    if (sideDone(moved, passed, stop, owed)) {
      const cleared = advanceStep(moved, passed, stop.id);
      return {
        ...cleared, effects: [announce, ...cleared.effects], logs: [used, ...(cleared.logs ?? [])],
      };
    }
    if (passed.task?.stopId === stop.id && passed.task.option === owed.option) {
      return { state: moved, effects: [announce], logs: [used] };
    }
    const begun = beginTask(moved, passed, stop, owed, a.player);
    return {
      ...begun, effects: [announce, ...begun.effects], logs: [used, ...(begun.logs ?? [])],
    };
  }
  const cleared = advanceStep(replaceTeam(state, kept), kept, stop.id);
  return {
    ...cleared, effects: [announce, ...cleared.effects], logs: [used, ...(cleared.logs ?? [])],
  };
}
