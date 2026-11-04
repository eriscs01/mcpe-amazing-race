// Tasks as world writes and events (spec §7.1): a zone's blocks, a bow and arrows, and the
// racers' shots and broken blocks reported to the core. What counts is decided in core.
import { ItemStack, Player, world } from '@minecraft/server';

import { DimensionWorld } from './blockWorld.js';
import { takeCounted } from './items.js';
import { online } from './online.js';
import { OVERWORLD } from './race.js';
import { applyOps } from '../core/arena/layout.js';
import { ENTITY } from '../core/config.js';
import { guard } from '../core/log.js';
import { parseHuntTag } from '../core/tasks/hunt.js';

import type { Entity } from '@minecraft/server';

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

/** Husks that are still fighting: valid, and not on their way out. */
const alive = (entity: Entity): boolean => entity.isValid
  && (entity.getComponent('minecraft:health')?.currentValue ?? 1) > 0;

/** Spawns a team's Hunt husks (or, topping up, only the ones missing) at the zone centre. */
export function spawnTargets(effect: Of<'spawnTargets'>, log: Logger): void {
  try {
    const dimension = world.getDimension(OVERWORLD);
    const living = effect.topUp ? dimension.getEntities({ tags: [effect.tag] }).filter(alive) : [];
    const have = living.length;
    const missing = Math.max(0, effect.count - have);
    const at = { x: effect.at.x + 0.5, y: effect.at.y, z: effect.at.z + 0.5 };
    for (let i = 0; i < missing; i += 1) {
      const husk = dimension.spawnEntity(ENTITY.husk, at);
      husk.nameTag = effect.name;
      husk.addTag(effect.tag);
    }
    log.info('targetsSpawned', {
      tag: effect.tag, spawned: missing, alive: have, topUp: effect.topUp,
    });
  } catch (error) {
    log.error('spawnTargetsFailed', error, { tag: effect.tag, count: effect.count });
  }
}

/** Removes handed-in items from a player's inventory; the core decided how many. */
export function takeVanilla(effect: Of<'takeVanilla'>, log: Logger): void {
  const player = online(effect.from);
  const removed = player ? takeCounted(player, effect.item, effect.count) : 0;
  const fields = {
    player: effect.from, item: effect.item, wanted: effect.count, removed,
  };
  if (removed === effect.count) log.info('itemsTaken', fields);
  else log.warn('itemsTakenShort', { ...fields, online: player !== undefined });
}

/** Racers' shots, broken blocks and Hunt kills, handed to the core as task events. */
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

  // Not filtered by type: a husk that turned into a zombie in water still carries its tag.
  world.afterEvents.entityDie.subscribe(guard(session.log, 'targetDied', (ev) => {
    const dead = ev.deadEntity;
    if (!dead.isValid) {
      // Nothing can be read from it; a lost kill is recovered by using the clue box again.
      session.log.warn('targetDieInvalid', { type: dead.typeId });
      return;
    }
    const tag = dead.getTags().find((t) => parseHuntTag(t) !== undefined);
    if (!tag) return;
    const killer = ev.damageSource.damagingEntity;
    session.dispatch({
      type: 'targetDied', tag, ...(killer instanceof Player ? { killer: killer.id } : {}),
    });
  }));
}
