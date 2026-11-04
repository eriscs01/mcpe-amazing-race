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

/** What the player carries, as item id to total count (a Gather hand-in is judged from it). */
export function inventoryCounts(player: Player): Record<string, number> {
  const counts: Record<string, number> = {};
  const container = inventory(player);
  for (let slot = 0; container && slot < container.size; slot += 1) {
    const stack = container.getItem(slot);
    if (stack) counts[stack.typeId] = (counts[stack.typeId] ?? 0) + stack.amount;
  }
  return counts;
}

/** Removes up to `count` of the item from the player's inventory; returns how many went. */
export function takeCounted(player: Player, item: string, count: number): number {
  const container = inventory(player);
  let left = count;
  for (let slot = 0; container && slot < container.size && left > 0; slot += 1) {
    const stack = container.getItem(slot);
    if (stack?.typeId === item) {
      const taken = Math.min(left, stack.amount);
      if (taken === stack.amount) {
        container.setItem(slot, undefined);
      } else {
        stack.amount -= taken;
        container.setItem(slot, stack);
      }
      left -= taken;
    }
  }
  return count - left;
}
