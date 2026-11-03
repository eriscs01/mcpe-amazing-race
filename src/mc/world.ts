// Effect executor: applies the core's effects to the world. Holds no race rules.
import { Player, world } from '@minecraft/server';

import { giveItem, takeItem } from './items.js';

import type { Logger } from '../core/log.js';
import type { Effect, PlayerId } from '../core/types.js';

function online(id: PlayerId): Player | undefined {
  const entity = world.getEntity(id);
  return entity instanceof Player ? entity : undefined;
}

/** What the executor needs from the rest of the adapter. */
export interface EffectHost {
  generate: (effect: Extract<Effect, { kind: 'generateCourse' }>) => void;
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
    default: {
      const unknown: never = effect;
      throw new Error(`unknown effect ${JSON.stringify(unknown)}`);
    }
  }
}

export function executeEffects(effects: Effect[], log: Logger, host: EffectHost): void {
  for (const effect of effects) apply(effect, log, host);
}
