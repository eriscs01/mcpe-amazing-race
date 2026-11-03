// Pit Stop and leg end as world writes (spec §8.4, §8.5): teleport, reward, rest and
// elimination. What happens and when is decided in core; a player who is offline is logged and
// skipped (the rejoin re-applies nothing yet: follow-up).
import { GameMode, world } from '@minecraft/server';

import { online } from './online.js';
import { OVERWORLD } from './race.js';
import { PITSTOP } from '../core/config.js';

import type { Player } from '@minecraft/server';

import type { Logger } from '../core/log.js';
import type { Effect, PlayerId } from '../core/types.js';

type Of<K extends Effect['kind']> = Extract<Effect, { kind: K }>;

/** Runs `act` for each online player; one failing, or offline, does not stop the others. */
function eachOnline(
  ids: readonly PlayerId[],
  log: Logger,
  what: string,
  act: (player: Player) => void,
): void {
  ids.forEach((id) => {
    const player = online(id);
    if (!player) {
      log.warn('pitStopSkipped', { what, player: id, reason: 'offline' });
      return;
    }
    try {
      act(player);
    } catch (error) {
      log.error('pitStopFailed', error, { what, player: id });
    }
  });
}

export function teleportPlayers(effect: Of<'teleport'>, log: Logger): void {
  eachOnline(effect.players, log, 'teleport', (player) => player.teleport(effect.pos, {
    dimension: world.getDimension(OVERWORLD),
  }));
}

export function rewardWinners(effect: Of<'reward'>, log: Logger): void {
  eachOnline(effect.to, log, 'reward', (player) => player.addLevels(effect.levels));
  try {
    world.getDimension(OVERWORLD).spawnEntity(PITSTOP.firework, effect.at);
  } catch (error) {
    log.error('fireworkFailed', error, { x: effect.at.x, z: effect.at.z });
  }
}

export function restorePlayers(effect: Of<'restore'>, log: Logger): void {
  const instant = 1; // one tick is enough for an instant effect
  eachOnline(effect.players, log, 'restore', (player) => {
    player.addEffect(PITSTOP.heal, instant, { amplifier: 20, showParticles: false });
    player.addEffect(PITSTOP.feed, instant, { amplifier: 20, showParticles: false });
  });
}

export function spectate(effect: Of<'spectate'>, log: Logger): void {
  eachOnline(effect.players, log, 'spectate', (player) => player.setGameMode(GameMode.Spectator));
}
