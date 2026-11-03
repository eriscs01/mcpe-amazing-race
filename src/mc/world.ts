// Effect executor: applies the core's effects to the world. Holds no race rules.
import { Player, world } from '@minecraft/server';

import type { Logger } from '../core/log.js';
import type { Effect } from '../core/types.js';

function apply(effect: Effect, log: Logger): void {
  switch (effect.kind) {
    case 'notify': {
      const player = world.getEntity(effect.to);
      if (player instanceof Player) player.sendMessage(effect.text);
      else log.info('notifySkipped', { player: effect.to, code: effect.code, reason: 'offline' });
      break;
    }
    default: {
      const unknown: never = effect.kind;
      throw new Error(`unknown effect ${String(unknown)}`);
    }
  }
}

export function executeEffects(effects: Effect[], log: Logger): void {
  for (const effect of effects) apply(effect, log);
}
