// Sessions and the end of the race as world writes (spec §11, §12): the daylight cycle, the
// world put back as it was, the sidebar removed, players released and the Hunt husks removed.
// What to do and when is decided in core; failures are logged and never thrown.
import { GameMode, world } from '@minecraft/server';

import { online } from './online.js';
import { OBJECTIVE, OVERWORLD } from './race.js';

import type { Logger } from '../core/log.js';
import type { Effect } from '../core/types.js';

type Of<K extends Effect['kind']> = Extract<Effect, { kind: K }>;

/** Stops or restarts the daylight cycle; with `save`, reports the time of day it stopped at. */
export function setDaylight(
  effect: Of<'daylight'>,
  log: Logger,
  saveTime: (time: number) => void,
): void {
  try {
    world.gameRules.doDayLightCycle = effect.running;
    if (effect.time !== undefined) world.setTimeOfDay(effect.time);
    if (effect.save) saveTime(world.getTimeOfDay());
  } catch (error) {
    log.error('daylightFailed', error, { running: effect.running, save: effect.save });
  }
}

/** The gamerules and the time of day as the race found them (spec §12 step 2). */
export function restoreWorld(effect: Of<'restoreWorld'>, log: Logger): void {
  try {
    const { rules, time } = effect.snapshot;
    const set = world.gameRules;
    if (rules.keepInventory !== undefined) set.keepInventory = rules.keepInventory;
    if (rules.showCoordinates !== undefined) set.showCoordinates = rules.showCoordinates;
    if (rules.doDayLightCycle !== undefined) set.doDayLightCycle = rules.doDayLightCycle;
    world.setTimeOfDay(time);
    log.info('worldRestored', { time });
  } catch (error) {
    log.error('restoreWorldFailed', error);
  }
}

export function clearSidebar(log: Logger): void {
  try {
    const { scoreboard } = world;
    if (scoreboard.getObjective(OBJECTIVE)) scoreboard.removeObjective(OBJECTIVE);
  } catch (error) {
    log.error('clearSidebarFailed', error);
  }
}

/** Survival and the plain name tag for players the race is over for. */
export function resetPlayers(effect: Of<'resetPlayers'>, log: Logger): void {
  for (const id of effect.players) {
    const player = online(id);
    if (!player) {
      log.warn('resetSkipped', { player: id, reason: 'offline' });
    } else {
      try {
        player.setGameMode(GameMode.Survival);
        player.nameTag = player.name;
      } catch (error) {
        log.error('resetPlayerFailed', error, { player: id });
      }
    }
  }
}

/**
 * Removes Hunt husks (tag `hunt:<team>:…`): a team's, or all. Only those in loaded chunks can be
 * reached; the rest are found by the arena sweep when a team lights the arena again.
 */
export function clearHusks(effect: Of<'clearHusks'>, log: Logger): void {
  const prefix = effect.team === undefined ? 'hunt:' : `hunt:${effect.team}:`;
  try {
    const husks = world.getDimension(OVERWORLD).getEntities({ families: ['monster'] })
      .filter((e) => e.getTags().some((t) => t.startsWith(prefix)));
    husks.forEach((e) => e.remove());
    log.info('husksCleared', { team: effect.team, removed: husks.length });
  } catch (error) {
    log.error('clearHusksFailed', error, { team: effect.team });
  }
}
