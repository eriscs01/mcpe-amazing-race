// Menu item recognition (spec §3): a vanilla item counts as Race Control or a Passport only with
// the exact type, name tag and lore. The adapter reads these fields from the held ItemStack.
import { ITEM, PASSPORT, RACE_CONTROL } from './config.js';

import type { MenuItem } from './config.js';
import type { MenuItemRole } from './types.js';

export const MENU_ITEMS: Record<MenuItemRole, MenuItem> = {
  raceControl: RACE_CONTROL,
  passport: PASSPORT,
};

/** The fields of a held item that recognition looks at. */
export interface HeldItem {
  typeId: string;
  nameTag: string | undefined;
  lore: readonly string[];
}

const matches = (held: HeldItem, spec: MenuItem): boolean => held.typeId === spec.item
  && held.nameTag === spec.nameTag
  && held.lore.length === spec.lore.length
  && held.lore.every((line, i) => line === spec.lore[i]);

export function roleOf(held: HeldItem): MenuItemRole | undefined {
  const roles = Object.keys(MENU_ITEMS) as MenuItemRole[];
  return roles.find((role) => matches(held, MENU_ITEMS[role]));
}

/** A clock with no custom name or lore, the only kind that claims or replaces the host item. */
export function isPlainClock(held: HeldItem): boolean {
  return held.typeId === ITEM.clock && held.nameTag === undefined && held.lore.length === 0;
}
