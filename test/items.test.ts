// Menu items are recognised by type + name tag + lore (spec §3); any other clock or compass is
// ordinary, and only a plain clock (no name, no lore) can claim or replace the host item.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ITEM, PASSPORT, RACE_CONTROL } from '../src/core/config.js';
import { isPlainClock, MENU_ITEMS, roleOf } from '../src/core/items.js';

const held = (typeId: string, nameTag?: string, lore: string[] = []) => ({ typeId, nameTag, lore });

test('Race Control and Passport are recognised by type, name tag and lore', () => {
  const rc = held(ITEM.clock, RACE_CONTROL.nameTag, [...RACE_CONTROL.lore]);
  assert.equal(roleOf(rc), 'raceControl');
  assert.equal(roleOf(held(ITEM.compass, PASSPORT.nameTag, [...PASSPORT.lore])), 'passport');
});

test('a renamed copy without the lore, or the wrong item type, is not a menu item', () => {
  assert.equal(roleOf(held(ITEM.clock, RACE_CONTROL.nameTag)), undefined);
  assert.equal(roleOf(held(ITEM.compass, RACE_CONTROL.nameTag, [...RACE_CONTROL.lore])), undefined);
  assert.equal(roleOf(held(ITEM.clock, '§6Race Control!', [...RACE_CONTROL.lore])), undefined);
  assert.equal(roleOf(held(ITEM.clock)), undefined);
});

test('only an unnamed clock without lore is a plain clock', () => {
  assert.equal(isPlainClock(held(ITEM.clock)), true);
  assert.equal(isPlainClock(held(ITEM.clock, 'My clock')), false);
  assert.equal(isPlainClock(held(ITEM.clock, undefined, ['x'])), false);
  assert.equal(isPlainClock(held(ITEM.compass)), false);
});

test('MENU_ITEMS maps each role to its spec item', () => {
  assert.equal(MENU_ITEMS.raceControl, RACE_CONTROL);
  assert.equal(MENU_ITEMS.passport, PASSPORT);
});
