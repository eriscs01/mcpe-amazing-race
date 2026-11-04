// Rules enforcement in the world (spec §7.4, §9.4): arena blocks that cannot be broken, blocks a
// racer places inside an arena taken back, the mob sweep and the elytra and ender pearl sweep.
// The core decides what is protected and what is swept (core/race/protect.ts); this only asks
// and carries it out. Failures are logged and never thrown.
import {
  EquipmentSlot, ItemStack, system, world,
} from '@minecraft/server';

import { online } from './online.js';
import { OVERWORLD } from './race.js';
import { RULES } from '../core/config.js';
import { guard } from '../core/log.js';
import {
  breakAllowed, sweepAreas, sweepKeep, sweepTargets,
} from '../core/race/protect.js';

import type { Logger } from '../core/log.js';
import type { Session } from '../core/session.js';
import type { Effect } from '../core/types.js';

/** Breaks cancelled and placements taken back, decided from the state in memory. */
export function wireProtection(session: Session): void {
  world.beforeEvents.playerBreakBlock.subscribe(guard(session.log, 'protectBreak', (ev) => {
    const { state } = session;
    if (!state || ev.block.dimension.id !== OVERWORLD) return;
    if (breakAllowed(state, ev.player.id, ev.block.location, ev.block.typeId)) return;
    ev.cancel = true; // eslint-disable-line no-param-reassign -- cancelling is the event's API
    // A before-event cannot write to the world: the notice goes out next tick.
    system.run(guard(session.log, 'protectNotice', () => {
      ev.player.onScreenDisplay.setActionBar('The arena is protected.');
    }));
  }));

  world.afterEvents.playerPlaceBlock.subscribe(guard(session.log, 'blockPlaced', (ev) => {
    if (ev.dimension.id !== OVERWORLD) return;
    session.dispatch({
      type: 'blockPlaced',
      player: ev.player.id,
      pos: ev.block.location,
      item: ev.block.getItemStack(1, true)?.typeId ?? ev.block.typeId,
    });
  }));
}

/** Removes a racer's block from an arena and gives the item back (a full pack drops it). */
export function undoPlace(effect: Extract<Effect, { kind: 'undoPlace' }>, log: Logger): void {
  try {
    const block = world.getDimension(OVERWORLD).getBlock(effect.pos);
    if (!block) {
      log.warn('undoPlaceSkipped', { player: effect.player, reason: 'unloaded' });
      return;
    }
    block.setType('minecraft:air');
    const player = online(effect.player);
    if (!player) return;
    const stack = new ItemStack(effect.item, 1);
    const left = player.getComponent('minecraft:inventory')?.container?.addItem(stack) ?? stack;
    if (left) player.dimension.spawnItem(left, player.location);
  } catch (error) {
    log.error('undoPlaceFailed', error, { player: effect.player, item: effect.item });
  }
}

/** Every 5 s: hostile mobs inside lit arenas, but the husks of a Hunt being played (spec §7.4). */
export function sweepMobs(session: Session): void {
  const { state } = session;
  if (!state) return;
  const areas = sweepAreas(state);
  if (areas.length === 0) return;
  const excludeTags = sweepKeep(state);
  const dimension = world.getDimension(OVERWORLD);
  const removed = areas.reduce((count, area) => {
    try {
      const mobs = dimension.getEntities({
        location: area.min,
        volume: {
          x: area.max.x - area.min.x + 1,
          y: area.max.y - area.min.y + 1,
          z: area.max.z - area.min.z + 1,
        },
        families: ['monster'],
        ...(excludeTags.length > 0 ? { excludeTags } : {}),
      });
      mobs.forEach((mob) => mob.remove());
      return count + mobs.length;
    } catch (error) {
      session.log.error('mobSweepFailed', error, { at: JSON.stringify(area.min) });
      return count;
    }
  }, 0);
  if (removed > 0) session.log.info('mobsSwept', { removed });
}

const EQUIPMENT = [EquipmentSlot.Chest, EquipmentSlot.Offhand];

/** Every 10 s: elytra and ender pearls leave the racers' inventories and worn slots. */
export function sweepItems(session: Session): void {
  const { state } = session;
  if (!state) return;
  const banned: readonly string[] = RULES.sweep.items;
  sweepTargets(state).forEach((id) => {
    const player = online(id);
    if (!player) return;
    try {
      let removed = 0;
      const container = player.getComponent('minecraft:inventory')?.container;
      for (let slot = 0; container && slot < container.size; slot += 1) {
        const item = container.getItem(slot);
        if (item && banned.includes(item.typeId)) {
          container.setItem(slot);
          removed += 1;
        }
      }
      const worn = player.getComponent('minecraft:equippable');
      EQUIPMENT.forEach((slot) => {
        const item = worn?.getEquipment(slot);
        if (item && banned.includes(item.typeId)) {
          worn?.setEquipment(slot);
          removed += 1;
        }
      });
      if (removed > 0) session.log.info('itemsSwept', { player: id, removed });
    } catch (error) {
      session.log.error('itemSweepFailed', error, { player: id });
    }
  });
}
