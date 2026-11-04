// The clue-box menus of a Detour and a Roadblock (spec §7.3, §8.2): choosing an option or the
// performer, then, mid-task, handing in or answering, getting gear again, switching and quitting.
// A menu is only a list of buttons; each choice comes back as `taskChoice` and is re-checked
// against the state, because a form can be stale. What a task counts is in task.ts and tasks/*.
import { advanceStep } from './advance.js';
import { owe } from './penalty.js';
import {
  beginTask, boxUsed, eligible, merge, offersOf, playing, prepareZone, replaceTeam,
  taskProgressText, teamOf,
} from './task.js';
import { clueBoxPos, targetStop } from '../clue.js';
import {
  HOUR, PENALTY_HOURS, RACE, ROADBLOCK_HINTS, TICKS_PER_SECOND,
} from '../config.js';
import { mayPerform, roadblockCapFor } from '../teams.js';
import { distance } from '../vec.js';

import type { Playing } from './task.js';
import type { Held } from '../tasks/kind.js';
import type {
  Action, Effect, LogLine, PlayerId, Result, State, Stop, TaskChoice, Team,
} from '../types.js';

type Of<T extends Action['type']> = Extract<Action, { type: T }>;
type Members = Of<'interactClue'>['members'];
type Menu = Extract<Effect, { kind: 'taskMenu' }>['menu'];

const nameOf = (state: State, id: PlayerId): string => state.players[id]?.name ?? id;
const hoursFor = (stop: Stop): number => (
  stop.type === 'roadblock' ? PENALTY_HOURS.quitRoadblock : PENALTY_HOURS.quitDetour);
const quitLabel = (stop: Stop): string => `Quit (+${hoursFor(stop)} h)`;

const heldOf = (members: Members): Held => Object.fromEntries(
  members.map((m) => [m.id, m.items ?? {}]),
);

const menuTo = (to: PlayerId, stop: Stop, menu: Menu): Effect => ({
  kind: 'taskMenu', to, stopId: stop.id, menu,
});
const say = (to: PlayerId, code: string, text: string): Effect => ({
  kind: 'notify', to, code, text,
});
const button = (command: TaskChoice, label: string): Menu['buttons'][number] => ({
  command, label,
});

const ignoredLog = (state: State, a: Of<'taskChoice'>, reason: string): LogLine => {
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
const ignored = (state: State, a: Of<'taskChoice'>, reason: string): Result => ({
  state, effects: [], logs: [ignoredLog(state, a, reason)],
});

const progressOf = (state: State, team: Team): string => (
  taskProgressText(state, team) ?? 'Task in progress.');

/**
 * Whether the team is at the box (spec §8.2): every online member within the presence radius, or
 * only the performer while a Roadblock is under way. Used when the box is used and again when a
 * menu button comes back, since the others may have walked off meanwhile.
 */
export function together(stop: Stop, team: Team, members: Members): boolean {
  const box = clueBoxPos(stop);
  const centre = { x: box.x + 0.5, y: box.y + 0.5, z: box.z + 0.5 };
  const must = stop.type === 'roadblock' && team.task?.stopId === stop.id
    ? members.filter((m) => m.id === team.performer) : members;
  return must.every((m) => m.pos && distance(m.pos, centre) <= RACE.presenceRadius);
}

const hasTaskHere = (team: Team, stop: Stop): boolean => team.task?.stopId === stop.id;

/** Every Roadblock of the course, Recall included: the total the per-player cap divides. */
const roadblocksIn = (state: State): number => state.stops
  .filter((s) => s.type === 'roadblock').length;

/** The performers a team may pick from: its online members under the cap. */
const candidates = (state: State, team: Team, members: Members): PlayerId[] => {
  const cap = roadblockCapFor(team, roadblocksIn(state));
  return members.map((m) => m.id)
    .filter((id) => team.members.includes(id) && mayPerform(team, id, cap));
};

function optionMenu(state: State, stop: Stop, player: PlayerId): Result {
  const buttons = offersOf(stop).map((o) => button({ type: 'option', option: o.option }, o.label));
  const body = 'Choose how your team takes this Detour.';
  return {
    state, effects: [menuTo(player, stop, { title: `${stop.name}: Detour`, body, buttons })],
  };
}

/** The hint only: the task itself is revealed once the performer is chosen (spec §8.2). */
function performerMenu(
  state: State,
  team: Team,
  stop: Stop,
  player: PlayerId,
  members: Members,
): Result {
  const hint = stop.task?.type === 'roadblock' ? ROADBLOCK_HINTS[stop.task.kind] : '';
  const buttons = candidates(state, team, members)
    .map((id) => button({ type: 'perform', who: id }, nameOf(state, id)));
  return {
    state,
    effects: [menuTo(player, stop, {
      title: `${stop.name}: Roadblock`, body: `${hint}\nWho will perform it?`, buttons,
    })],
  };
}

/** The menu of a task under way, for a player who may play it. */
function playMenu(state: State, team: Team, now: Playing, player: PlayerId): Menu {
  const { kind } = now.offer;
  const progress = progressOf(state, team);
  const other = now.stop.type === 'detour'
    ? offersOf(now.stop).find((o) => o.option !== now.offer.option) : undefined;
  return {
    title: `${now.stop.name}: ${now.offer.label}`,
    body: progress,
    buttons: [
      ...(kind.boxAction ? [button({ type: 'continue' }, kind.boxAction)] : []),
      ...(kind.equip(now.ctx, [player]).length > 0
        ? [button({ type: 'gear' }, 'Get gear again')] : []),
      ...(other ? [button({ type: 'switch' }, `Switch to ${other.label}`)] : []),
      button({ type: 'quit' }, quitLabel(now.stop)),
    ],
  };
}

/**
 * A racer used the clue box of a Detour or Roadblock whose task is playable and the team is
 * together: show the option or performer menu, or, with the task under way, its menu.
 */
export function useTaskBox(
  state: State,
  team: Team,
  stop: Stop,
  player: PlayerId,
  members: Members,
): Result {
  if (!hasTaskHere(team, stop)) {
    return stop.type === 'roadblock'
      ? performerMenu(state, team, stop, player, members)
      : optionMenu(state, stop, player);
  }
  // A zone whose build failed was forgotten (`zoneBuildFailed`); using the box again retries.
  const offer = offersOf(stop).find((o) => o.option === team.task?.option);
  const zone = offer ? prepareZone(state, stop, offer) : { state, effects: [] };
  const now = playing(zone.state, team);
  if (!now) return zone;
  const { performer } = team;
  if (stop.type === 'roadblock' && performer !== player) {
    const performing = performer !== undefined && members.some((m) => m.id === performer);
    // With the performer away, any member may still quit so the race can go on.
    const out: Effect[] = performing
      ? [say(player, 'performing', `${nameOf(state, performer)} is performing this Roadblock.`)]
      : [menuTo(player, stop, {
        title: `${stop.name}: Roadblock`,
        body: `${performer ? nameOf(state, performer) : 'The performer'} is not here.`,
        buttons: [button({ type: 'quit' }, quitLabel(stop))],
      })];
    return merge(zone, { state: zone.state, effects: out });
  }
  // A kind with no box action of its own (Hunt) acts on the box use itself, as it always did.
  const acted = now.offer.kind.boxAction ? { state: zone.state, effects: [] }
    : boxUsed(zone.state, team, now, player, { [player]: {} });
  const merged = merge(zone, acted);
  const after = merged.state.teams.find((t) => t.id === team.id);
  const here = after ? playing(merged.state, after) : undefined;
  if (!after || !here) return merged;
  return {
    ...merged,
    effects: [...merged.effects, menuTo(player, stop, playMenu(merged.state, after, here, player))],
  };
}

function perform(state: State, a: Of<'taskChoice'>, team: Team, stop: Stop): Result {
  if (stop.type !== 'roadblock') return ignored(state, a, 'notRoadblock');
  const { choice } = a;
  if (choice.type !== 'perform') return ignored(state, a, 'notPerform');
  if (hasTaskHere(team, stop)) {
    const who = team.performer ? nameOf(state, team.performer) : 'Someone';
    return {
      state,
      effects: [say(a.player, 'performing', `${who} is performing this Roadblock.`)],
      logs: [ignoredLog(state, a, 'alreadyChosen')],
    };
  }
  if (!candidates(state, team, a.members).includes(choice.who)) {
    return ignored(state, a, 'notEligible');
  }
  const [offer] = offersOf(stop);
  if (!offer) return ignored(state, a, 'noOffer');
  const counted: Team = {
    ...team,
    roadblockCounts: {
      ...team.roadblockCounts, [choice.who]: (team.roadblockCounts[choice.who] ?? 0) + 1,
    },
  };
  return beginTask(replaceTeam(state, counted), counted, stop, offer, a.player, choice.who);
}

function chooseOption(state: State, a: Of<'taskChoice'>, team: Team, stop: Stop): Result {
  const { choice } = a;
  if (stop.type !== 'detour' || choice.type !== 'option') return ignored(state, a, 'notDetour');
  if (hasTaskHere(team, stop)) {
    const label = offersOf(stop).find((o) => o.option === team.task?.option)?.label ?? 'a task';
    return {
      state,
      effects: [say(a.player, 'alreadyStarted', `Your team is doing ${label}.`)],
      logs: [ignoredLog(state, a, 'alreadyStarted')],
    };
  }
  const offer = offersOf(stop).find((o) => o.option === choice.option);
  if (!offer) return ignored(state, a, 'noSuchOption');
  return beginTask(state, team, stop, offer, a.player);
}

function quit(state: State, team: Team, now: Playing, to: PlayerId): Result {
  const { stop } = now;
  const reason = stop.type === 'roadblock' ? 'quitRoadblock' : 'quitDetour';
  const owed = owe(team, hoursFor(stop), reason);
  const {
    task, performer, lockoutUntil, ...rest
  } = owed.team;
  const left: Team = rest;
  const cleared = advanceStep(replaceTeam(state, left), left, stop.id);
  return {
    state: cleared.state,
    effects: [
      {
        kind: 'title',
        to: team.members,
        text: `${nameOf(state, to)} quit ${stop.name}: +${hoursFor(stop)} h, `
          + 'served at the Pit Stop.',
        chat: true,
      },
      ...cleared.effects,
    ],
    logs: [
      {
        event: 'taskQuit',
        fields: {
          team: team.id, leg: team.leg, stop: stop.id, by: to,
        },
      },
      owed.log,
      ...(cleared.logs ?? []),
    ],
  };
}

function switchOption(
  state: State,
  team: Team,
  now: Playing,
  to: PlayerId,
  held: Held,
): Result {
  const other = offersOf(now.stop).find((o) => o.option !== now.offer.option);
  if (now.stop.type !== 'detour' || !other) return { state, effects: [] };
  const out = beginTask(state, team, now.stop, other, to, undefined, held);
  return {
    ...out,
    logs: [...(out.logs ?? []), {
      event: 'taskSwitched',
      fields: {
        team: team.id, leg: team.leg, stop: now.stop.id, from: now.offer.option, to: other.option,
      },
    }],
  };
}

/** A button of the menu was chosen: re-checked, then done. */
export function taskChoice(state: State, a: Of<'taskChoice'>): Result {
  if (state.phase !== 'running') return ignored(state, a, 'notRunning');
  const team = teamOf(state, a.player);
  if (team?.status !== 'racing' || team.departAt !== undefined) {
    return ignored(state, a, 'notRacing');
  }
  const stop = state.stops.find((s) => s.id === a.stopId);
  if (!stop || targetStop(state, team)?.id !== stop.id) return ignored(state, a, 'notYourStop');
  if (!together(stop, team, a.members)) return ignored(state, a, 'notTogether');
  const { choice } = a;
  if (choice.type === 'option') return chooseOption(state, a, team, stop);
  if (choice.type === 'perform') return perform(state, a, team, stop);
  const now = hasTaskHere(team, stop) ? playing(state, team) : undefined;
  if (!now) return ignored(state, a, 'noTask');
  const { performer } = team;
  // With the Roadblock's performer away, any member may quit so the team is not stuck.
  const away = stop.type === 'roadblock' && performer !== undefined
    && !a.members.some((m) => m.id === performer);
  const quitting = choice.type === 'quit' || choice.type === 'confirmQuit';
  if (!eligible(team, stop, a.player) && !(away && quitting)) {
    return ignored(state, a, 'notEligible');
  }
  const held = heldOf(a.members.filter((m) => eligible(team, stop, m.id)));
  switch (choice.type) {
    case 'continue':
      return boxUsed(state, team, now, a.player, held);
    case 'status':
      return {
        state,
        effects: [say(a.player, 'taskProgress', progressOf(state, team))],
      };
    case 'gear': {
      const gifts = now.offer.kind.equip(now.ctx, [a.player], heldOf(a.members));
      return {
        state,
        effects: gifts.length > 0 ? gifts : [say(a.player, 'gear', 'You already have your gear.')],
        logs: [{
          event: 'gearGiven',
          fields: {
            team: team.id, stop: stop.id, player: a.player, items: gifts.length,
          },
        }],
      };
    }
    case 'switch':
      return switchOption(state, team, now, a.player, heldOf(a.members));
    case 'quit': {
      const seconds = (hoursFor(stop) * HOUR) / TICKS_PER_SECOND;
      return {
        state,
        effects: [menuTo(a.player, stop, {
          title: `${stop.name}: Quit?`,
          body: 'You skip this task and take the next clue; the penalty is served at the Pit Stop.',
          buttons: [
            button({ type: 'confirmQuit' }, `Yes, quit (+${hoursFor(stop)} h = ${seconds} s)`),
            button({ type: 'status' }, 'Keep playing'),
          ],
        })],
      };
    }
    case 'confirmQuit':
      return quit(state, team, now, a.player);
    default: {
      const unknown: never = choice;
      throw new Error(`unknown choice ${JSON.stringify(unknown)}`);
    }
  }
}
