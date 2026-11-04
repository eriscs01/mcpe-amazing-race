// The clue-box menus of a Detour, a Roadblock and a Speed Bump (spec §7.3, §8.2, §8.7): choosing
// an option or the performer, then, mid-task, handing in or answering, getting gear again,
// switching and quitting. A menu is only a list of buttons (flowMenus.ts); each choice comes back
// as `taskChoice` and is re-checked against the state, because a form can be stale. What a task
// counts is in task.ts and tasks/*; the advantages are spent in advantageFlow.ts.
import { advanceStep } from './advance.js';
import { useExpressPass, uTurn } from './advantageFlow.js';
import { expressUsable, uTurnOpen, uTurnTargets } from './advantages.js';
import {
  boardMenu, button, candidates, hasTaskHere, ignored, ignoredLog, menuTo, nameOf, optionMenu,
  performerMenu, playMenu, progressOf, quitCost, say, speedBumpMenu,
} from './flowMenus.js';
import { owe } from './penalty.js';
import {
  beginTask, boxUsed, eligible, merge, offersOf, playing, prepareZone, replaceTeam, sideDone,
  teamOf,
} from './task.js';
import { clueBoxPos, targetStop } from '../clue.js';
import { HOUR, RACE, TICKS_PER_SECOND } from '../config.js';
import { distance } from '../vec.js';

import type { Members, Of } from './flowMenus.js';
import type { Playing } from './task.js';
import type { Held } from '../tasks/kind.js';
import type {
  Effect, PlayerId, Result, State, Stop, Team,
} from '../types.js';

const heldOf = (members: Members): Held => Object.fromEntries(
  members.map((m) => [m.id, m.items ?? {}]),
);

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

/**
 * A Speed Bump's quiz starts at once, unless an Express Pass could skip it (`offer`): then a menu
 * comes first, so the pass is not locked behind an open question form.
 */
function startSpeedBump(
  state: State,
  team: Team,
  stop: Stop,
  player: PlayerId,
  offer: boolean,
): Result {
  const [quiz] = offersOf(stop);
  if (!quiz) return { state, effects: [] };
  return offer && expressUsable(state, team)
    ? speedBumpMenu(state, team, stop, player) : beginTask(state, team, stop, quiz, player);
}

/** The first thing a stop shows a team that has not started its task here. */
function firstMenu(
  state: State,
  team: Team,
  stop: Stop,
  player: PlayerId,
  members: Members,
): Result {
  if (stop.type === 'roadblock') return performerMenu(state, team, stop, player, members);
  if (stop.type === 'route') return startSpeedBump(state, team, stop, player, true);
  const targets = uTurnOpen(state, team, stop) ? uTurnTargets(state, team, stop) : [];
  return targets.length > 0
    ? boardMenu(state, stop, player, targets) : optionMenu(state, team, stop, player);
}

/**
 * A racer used the clue box of a Detour, a Roadblock or a Speed Bump and the team is together:
 * show the first menu, or, with the task under way, its menu.
 */
export function useTaskBox(
  state: State,
  team: Team,
  stop: Stop,
  player: PlayerId,
  members: Members,
): Result {
  if (!hasTaskHere(team, stop)) return firstMenu(state, team, stop, player, members);
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
        buttons: [button({ type: 'quit' }, `Quit (+${quitCost(stop).hours} h)`)],
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
  const { hours, reason } = quitCost(stop);
  const owed = owe(team, hours, reason);
  // The step moves on, which ends the task, the performer, the lockout and a U-Turn mark.
  const cleared = advanceStep(replaceTeam(state, owed.team), owed.team, stop.id);
  return {
    state: cleared.state,
    effects: [
      {
        kind: 'title',
        to: team.members,
        text: `${nameOf(state, to)} quit ${stop.name}: +${hours} h, served at the Pit Stop.`,
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
  a: Of<'taskChoice'>,
  team: Team,
  now: Playing,
  held: Held,
): Result {
  const other = offersOf(now.stop).find((o) => o.option !== now.offer.option);
  if (now.stop.type !== 'detour' || !other) return { state, effects: [] };
  if (sideDone(state, team, now.stop, other)) return ignored(state, a, 'sideDone');
  const out = beginTask(state, team, now.stop, other, a.player, undefined, held);
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
  // Choices that start something or spend an advantage: no task needs to be under way yet.
  switch (choice.type) {
    case 'option':
      return chooseOption(state, a, team, stop);
    case 'perform':
      return perform(state, a, team, stop);
    case 'uturn':
      return uTurn(state, a, team, stop);
    case 'expressPass':
      return useExpressPass(state, a, team, stop);
    case 'noUturn':
      return stop.type === 'detour' && !hasTaskHere(team, stop)
        ? optionMenu(state, team, stop, a.player) : ignored(state, a, 'noBoard');
    case 'start':
      return stop.type === 'route' && team.speedBump && !hasTaskHere(team, stop)
        ? startSpeedBump(state, team, stop, a.player, false) : ignored(state, a, 'noSpeedBump');
    default:
      break;
  }
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
      return switchOption(state, a, team, now, heldOf(a.members));
    case 'quit': {
      const { hours } = quitCost(stop);
      const seconds = (hours * HOUR) / TICKS_PER_SECOND;
      return {
        state,
        effects: [menuTo(a.player, stop, {
          title: `${stop.name}: Quit?`,
          body: 'You skip this task and take the next clue; the penalty is served at the Pit Stop.',
          buttons: [
            button({ type: 'confirmQuit' }, `Yes, quit (+${hours} h = ${seconds} s)`),
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
