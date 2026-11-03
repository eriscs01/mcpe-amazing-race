// Tasks as world writes and events (spec §7.1): a zone's blocks, a bow and arrows, and the
// racers' shots and broken blocks reported to the core. What counts is decided in core.
import { ItemStack, Player, world } from '@minecraft/server';

import { DimensionWorld } from './blockWorld.js';
import { online } from './online.js';
import { OVERWORLD } from './race.js';
import { applyOps } from '../core/arena/layout.js';
import { guard } from '../core/log.js';

import type { Logger } from '../core/log.js';
import type { Session } from '../core/session.js';
import type { Effect } from '../core/types.js';

type Of<K extends Effect['kind']> = Extract<Effect, { kind: K }>;

/** Builds a zone's blocks now: the team is standing in the arena, so its chunks are loaded. */
export function buildZone(
  effect: Of<'zoneBlocks'>,
  log: Logger,
  failed: (stop: number, zone: Of<'zoneBlocks'>['zone']) => void,
): void {
  try {
    const dimension = world.getDimension(OVERWORLD);
    // The operations are few (at most a pile and nine blocks), so they run in one go.
    const steps = applyOps(new DimensionWorld(dimension), effect.ops);
    while (!steps.next().done) { /* each step is one operation */ }
    log.info('zoneBuilt', { stop: effect.stop, zone: effect.zone, ops: effect.ops.length });
  } catch (error) {
    log.error('zoneBuildFailed', error, { stop: effect.stop, zone: effect.zone });
    failed(effect.stop, effect.zone);
  }
}

/** Gives a plain vanilla item; with a full inventory it is dropped at the player's feet. */
export function giveVanilla(effect: Of<'giveVanilla'>, log: Logger): void {
  const player = online(effect.to);
  if (!player) {
    log.warn('itemSkipped', { player: effect.to, item: effect.item, reason: 'offline' });
    return;
  }
  const stack = new ItemStack(effect.item, effect.count);
  const left = player.getComponent('minecraft:inventory')?.container?.addItem(stack) ?? stack;
  if (left) player.dimension.spawnItem(left, player.location);
  log.info('itemGiven', { player: effect.to, item: effect.item, count: effect.count });
}

/** Racers' shots and broken blocks, handed to the core as task events. */
export function wireTaskEvents(session: Session): void {
  const racer = (id: string): boolean => session.state?.phase === 'running'
    && session.state.players[id]?.teamId !== undefined;

  world.afterEvents.projectileHitBlock.subscribe(guard(session.log, 'projectileHit', (ev) => {
    const shooter = ev.source;
    if (!(shooter instanceof Player) || ev.dimension.id !== OVERWORLD || !racer(shooter.id)) return;
    const { block } = ev.getBlockHit();
    session.dispatch({
      type: 'taskEvent',
      player: shooter.id,
      event: { type: 'projectileHit', block: block.location, shooter: shooter.location },
    });
  }));

  world.afterEvents.playerBreakBlock.subscribe(guard(session.log, 'blockBroken', (ev) => {
    if (ev.dimension.id !== OVERWORLD || !racer(ev.player.id)) return;
    session.dispatch({
      type: 'taskEvent',
      player: ev.player.id,
      // The block itself is air by now; the permutation says what it was.
      event: {
        type: 'blockBroken', block: ev.block.location, id: ev.brokenBlockPermutation.type.id,
      },
    });
  }));
}
