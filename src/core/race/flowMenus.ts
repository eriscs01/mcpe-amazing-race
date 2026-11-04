// What the clue-box menus of a Detour, Roadblock and Speed Bump show (spec §8.2, §8.7): their
// buttons, and the small helpers the flows share. A menu is only a list of buttons; each choice
// comes back as `taskChoice` and is re-checked in taskFlow.ts and advantageFlow.ts.
import { expressUsable, isUTurned } from './advantages.js';
import {
  offersOf, sideDone, taskProgressText, teamOf,
} from './task.js';
import { PENALTY_HOURS, ROADBLOCK_HINTS } from '../config.js';
import { mayPerform, roadblockCapFor } from '../teams.js';

import type { Playing } from './task.js';
import type {
  Action, Effect, LogLine, PlayerId, Result, State, Stop, TaskChoice, Team,
} from '../types.js';

export type Of<T extends Action['type']> = Extract<Action, { type: T }>;
export type Members = Of<'interactClue'>['members'];
export type Menu = Extract<Effect, { kind: 'taskMenu' }>['menu'];

export const nameOf = (state: State, id: PlayerId): string => state.players[id]?.name ?? id;

/** Race hours quitting this stop costs (spec §8.8), and the name its penalty is logged under. */
export function quitCost(stop: Stop): { hours: number; reason: string } {
  if (stop.type === 'roadblock') {
    return { hours: PENALTY_HOURS.quitRoadblock, reason: 'quitRoadblock' };
  }
  return stop.type === 'route'
    ? { hours: PENALTY_HOURS.quitSpeedBump, reason: 'quitSpeedBump' }
    : { hours: PENALTY_HOURS.quitDetour, reason: 'quitDetour' };
}
export const quitLabel = (stop: Stop): string => `Quit (+${quitCost(stop).hours} h)`;

export const menuTo = (to: PlayerId, stop: Stop, menu: Menu): Effect => ({
  kind: 'taskMenu', to, stopId: stop.id, menu,
});
export const say = (to: PlayerId, code: string, text: string): Effect => ({
  kind: 'notify', to, code, text,
});
export const button = (command: TaskChoice, label: string): Menu['buttons'][number] => ({
  command, label,
});

export const ignoredLog = (state: State, a: Of<'taskChoice'>, reason: string): LogLine => {
  const team = teamOf(state, a.player);
  return {
    event: 'taskChoiceIgnored',
    fields: {
      team: team?.id,
      leg: team?.leg,
      player: a.player,
      stop: a.stopId,
      choice: a.choice.type,
      reason,
    },
  };
};
export const ignored = (state: State, a: Of<'taskChoice'>, reason: string): Result => ({
  state, effects: [], logs: [ignoredLog(state, a, reason)],
});

export const hasTaskHere = (team: Team, stop: Stop): boolean => team.task?.stopId === stop.id;

export const progressOf = (state: State, team: Team): string => (
  taskProgressText(state, team) ?? 'Task in progress.');

/** The Express Pass buttons for a Detour's option menu: one, or one per side when U-Turned. */
const passButtons = (state: State, team: Team, stop: Stop): Menu['buttons'] => {
  if (!expressUsable(state, team)) return [];
  if (stop.type === 'detour' && isUTurned(team, stop)) {
    return offersOf(stop).map((o) => button(
      { type: 'expressPass', option: o.option },
      `Express Pass: skip ${o.label}`,
    ));
  }
  return [button({ type: 'expressPass' }, 'Use Express Pass')];
};

/** A Detour's options (and an Express Pass); the U-Turn board came before, if it applied. */
export function optionMenu(state: State, team: Team, stop: Stop, player: PlayerId): Result {
  const buttons = [
    ...offersOf(stop).map((o) => button({ type: 'option', option: o.option }, o.label)),
    ...passButtons(state, team, stop),
  ];
  const body = isUTurned(team, stop)
    ? 'You were U-Turned: you must complete both options.'
    : 'Choose how your team takes this Detour.';
  return {
    state, effects: [menuTo(player, stop, { title: `${stop.name}: Detour`, body, buttons })],
  };
}

/** The U-Turn board (spec §8.2): who to send back, or carry on to the options. */
export function boardMenu(
  state: State,
  stop: Stop,
  player: PlayerId,
  targets: Team[],
): Result {
  const buttons = [
    ...targets.map((t) => button({ type: 'uturn', team: t.id }, `U-Turn Team ${t.name}`)),
    button({ type: 'noUturn' }, 'No U-Turn'),
  ];
  const body = 'Use your U-Turn: that team must complete both options of this Detour.';
  return {
    state, effects: [menuTo(player, stop, { title: `${stop.name}: U-Turn board`, body, buttons })],
  };
}

/** Every Roadblock of the course, Recall included: the total the per-player cap divides. */
const roadblocksIn = (state: State): number => state.stops
  .filter((s) => s.type === 'roadblock').length;

/** The performers a team may pick from: its online members under the cap. */
export const candidates = (state: State, team: Team, members: Members): PlayerId[] => {
  const cap = roadblockCapFor(team, roadblocksIn(state));
  return members.map((m) => m.id)
    .filter((id) => team.members.includes(id) && mayPerform(team, id, cap));
};

/** The hint only: the task itself is revealed once the performer is chosen (spec §8.2). */
export function performerMenu(
  state: State,
  team: Team,
  stop: Stop,
  player: PlayerId,
  members: Members,
): Result {
  const hint = stop.task?.type === 'roadblock' ? ROADBLOCK_HINTS[stop.task.kind] : '';
  const buttons = [
    ...candidates(state, team, members)
      .map((id) => button({ type: 'perform', who: id }, nameOf(state, id))),
    ...passButtons(state, team, stop),
  ];
  return {
    state,
    effects: [menuTo(player, stop, {
      title: `${stop.name}: Roadblock`, body: `${hint}\nWho will perform it?`, buttons,
    })],
  };
}

/** A Speed Bump an Express Pass could skip: start it, or spend the pass (one form at a time). */
export function speedBumpMenu(state: State, team: Team, stop: Stop, player: PlayerId): Result {
  const buttons = [
    button({ type: 'start' }, 'Start Speed Bump'),
    ...passButtons(state, team, stop),
  ];
  const body = 'Answer 2 questions before you take the clue, or skip them with your Express Pass.';
  return {
    state,
    effects: [menuTo(player, stop, { title: `${stop.name}: Speed Bump`, body, buttons })],
  };
}

/** The menu of a task under way, for a player who may play it. */
export function playMenu(state: State, team: Team, now: Playing, player: PlayerId): Menu {
  const { kind } = now.offer;
  const other = now.stop.type === 'detour'
    ? offersOf(now.stop).find((o) => o.option !== now.offer.option) : undefined;
  // A U-Turned team cannot go back to a side it has finished or skipped.
  const canSwitch = other !== undefined && !sideDone(state, team, now.stop, other);
  return {
    title: `${now.stop.name}: ${now.offer.label}`,
    body: progressOf(state, team),
    buttons: [
      ...(kind.boxAction ? [button({ type: 'continue' }, kind.boxAction)] : []),
      ...(kind.equip(now.ctx, [player]).length > 0
        ? [button({ type: 'gear' }, 'Get gear again')] : []),
      ...(canSwitch ? [button({ type: 'switch' }, `Switch to ${other.label}`)] : []),
      ...(expressUsable(state, team) ? [button({ type: 'expressPass' }, 'Use Express Pass')] : []),
      button({ type: 'quit' }, quitLabel(now.stop)),
    ],
  };
}
