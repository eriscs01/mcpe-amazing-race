// Effect executor: applies the core's effects to the world. Holds no race rules.
import { giveItem, takeItem } from './items.js';
import { online } from './online.js';
import {
  restorePlayers, rewardWinners, spectate, teleportPlayers,
} from './pitstop.js';
import {
  broadcast, lockMovement, showSidebar, showTitle, startRacers,
} from './race.js';
import {
  buildZone, giveVanilla, spawnTargets, takeVanilla,
} from './tasks.js';

import type { Logger } from '../core/log.js';
import type { Effect } from '../core/types.js';

/** What the executor needs from the rest of the adapter. */
export interface EffectHost {
  generate: (effect: Extract<Effect, { kind: 'generateCourse' }>) => void;
  build: (effect: Extract<Effect, { kind: 'buildArenas' }>) => void;
  light: (effect: Extract<Effect, { kind: 'lightStops' }>) => void;
  /** A task zone could not be built (the core forgets it so the next box use retries). */
  zoneFailed: (stop: number, zone: Extract<Effect, { kind: 'zoneBlocks' }>['zone']) => void;
}

function apply(effect: Effect, log: Logger, host: EffectHost): void {
  switch (effect.kind) {
    case 'notify': {
      const player = online(effect.to);
      if (player) player.sendMessage(effect.text);
      else log.info('notifySkipped', { player: effect.to, code: effect.code, reason: 'offline' });
      break;
    }
    case 'giveItem': {
      const player = online(effect.to);
      if (!player) {
        log.warn('itemSkipped', { player: effect.to, item: effect.item, reason: 'offline' });
        break;
      }
      const to = giveItem(player, effect.item);
      log.info('itemGiven', { player: effect.to, item: effect.item, to });
      break;
    }
    case 'giveVanilla':
      giveVanilla(effect, log);
      break;
    case 'zoneBlocks':
      buildZone(effect, log, host.zoneFailed);
      break;
    case 'spawnTargets':
      spawnTargets(effect, log);
      break;
    case 'takeVanilla':
      takeVanilla(effect, log);
      break;
    case 'takeItem': {
      // An offline player's copy stays, but it is inert: Race Control works only for the host.
      const player = online(effect.from);
      const removed = player ? takeItem(player, effect.item) : 0;
      log.info('itemTaken', {
        player: effect.from, item: effect.item, removed, online: player !== undefined,
      });
      break;
    }
    case 'generateCourse':
      host.generate(effect);
      break;
    case 'buildArenas':
      host.build(effect);
      break;
    case 'lightStops':
      host.light(effect);
      break;
    case 'startRacers':
      startRacers(effect, log);
      break;
    case 'lockMovement':
      lockMovement(effect, log);
      break;
    case 'broadcast':
      broadcast(effect);
      break;
    case 'title':
      showTitle(effect, log);
      break;
    case 'sidebar':
      showSidebar(effect, log);
      break;
    case 'teleport':
      teleportPlayers(effect, log);
      break;
    case 'reward':
      rewardWinners(effect, log);
      break;
    case 'restore':
      restorePlayers(effect, log);
      break;
    case 'spectate':
      spectate(effect, log);
      break;
    default: {
      const unknown: never = effect;
      throw new Error(`unknown effect ${JSON.stringify(unknown)}`);
    }
  }
}

export function executeEffects(effects: Effect[], log: Logger, host: EffectHost): void {
  for (const effect of effects) apply(effect, log, host);
}
