// Race Control / Passport as real ItemStacks: create, find and remove them in a player's
// inventory. Which item is which is decided in core (items.ts).
import {
  EntityComponentTypes, ItemLockMode, ItemStack,
} from '@minecraft/server';

import { MENU_ITEMS, roleOf } from '../core/items.js';

import type { Container, Player } from '@minecraft/server';

import type { HeldItem } from '../core/items.js';
import type { MenuItemRole } from '../core/types.js';

export function heldOf(stack: ItemStack): HeldItem {
  // An unnamed stack may report '' rather than undefined; both mean "no custom name".
  const nameTag = stack.nameTag === '' ? undefined : stack.nameTag;
  return { typeId: stack.typeId, nameTag, lore: stack.getLore() };
}

function createMenuItem(role: MenuItemRole): ItemStack {
  const spec = MENU_ITEMS[role];
  const stack = new ItemStack(spec.item, 1);
  stack.nameTag = spec.nameTag;
  stack.setLore([...spec.lore]);
  stack.keepOnDeath = true;
  stack.lockMode = ItemLockMode.inventory;
  return stack;
}

function inventory(player: Player): Container | undefined {
  return player.getComponent(EntityComponentTypes.Inventory)?.container;
}

/** Slots holding the item, in slot order. */
function slotsWith(container: Container, role: MenuItemRole): number[] {
  const slots: number[] = [];
  for (let i = 0; i < container.size; i += 1) {
    const stack = container.getItem(i);
    if (stack && roleOf(heldOf(stack)) === role) slots.push(i);
  }
  return slots;
}

export function hasItem(player: Player, role: MenuItemRole): boolean {
  const container = inventory(player);
  return container !== undefined && slotsWith(container, role).length > 0;
}

/** Adds the item; with a full inventory it is dropped at the player's feet instead. */
export function giveItem(player: Player, role: MenuItemRole): 'inventory' | 'dropped' {
  const leftover = inventory(player)?.addItem(createMenuItem(role)) ?? createMenuItem(role);
  if (leftover === undefined) return 'inventory';
  player.dimension.spawnItem(leftover, player.location);
  return 'dropped';
}

/** Removes every copy; returns how many slots were cleared. */
export function takeItem(player: Player, role: MenuItemRole): number {
  const container = inventory(player);
  if (!container) return 0;
  const slots = slotsWith(container, role);
  for (const slot of slots) container.setItem(slot);
  return slots.length;
}
