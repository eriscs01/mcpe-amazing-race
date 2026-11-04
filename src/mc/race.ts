// Race start and the public display (spec §8.1, §10) as world writes: rules, kit, teleport,
// movement lock, titles, chat and the sidebar. What to do and when is decided in core.
import {
  DisplaySlotId, EntityComponentTypes, EquipmentSlot, GameMode, InputPermissionCategory, ItemStack,
  world,
} from '@minecraft/server';

import { inventoryCounts } from './items.js';
import { online } from './online.js';
import { KIT, RACE } from '../core/config.js';

import type { Player } from '@minecraft/server';

import type { Logger } from '../core/log.js';
import type { Session } from '../core/session.js';
import type { Effect, RaceSnapshot } from '../core/types.js';
import type { Vec3 } from '../core/vec.js';

type Of<K extends Effect['kind']> = Extract<Effect, { kind: K }>;

export const OVERWORLD = 'minecraft:overworld';
const OBJECTIVE = 'race';
const WORN = [
  EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet,
  EquipmentSlot.Offhand,
];

/** The rules the race changes and the time of day, as the world has them now (spec §8.1). */
export function readSnapshot(): RaceSnapshot {
  const rules = world.gameRules;
  return {
    rules: {
      keepInventory: rules.keepInventory,
      showCoordinates: rules.showCoordinates,
      doDayLightCycle: rules.doDayLightCycle,
    },
    time: world.getTimeOfDay(),
  };
}

function clearAndKit(player: Player): void {
  const container = player.getComponent(EntityComponentTypes.Inventory)?.container;
  container?.clearAll();
  const worn = player.getComponent(EntityComponentTypes.Equippable);
  for (const slot of WORN) worn?.setEquipment(slot);
  for (const { item, amount } of KIT) container?.addItem(new ItemStack(item, amount));
}

/** Sets the rules and time, then readies each racer; one racer failing does not stop the rest. */
export function startRacers(effect: Of<'startRacers'>, log: Logger): void {
  try {
    const rules = world.gameRules;
    rules.keepInventory = RACE.rules.keepInventory;
    rules.showCoordinates = RACE.rules.showCoordinates;
    rules.doDayLightCycle = effect.daylight;
    world.setTimeOfDay(effect.time);
  } catch (error) {
    log.error('raceRulesFailed', error, { daylight: effect.daylight, time: effect.time });
  }
  for (const racer of effect.racers) {
    const player = online(racer.id);
    if (!player) {
      log.warn('racerSkipped', { player: racer.id, reason: 'offline' });
    } else {
      try {
        clearAndKit(player);
        player.setGameMode(GameMode.Survival);
        player.nameTag = `${racer.color}${racer.name}`;
        // Arenas stand in the Overworld, wherever the racer is now; spots are block centres.
        player.teleport(
          { x: racer.spawn.x + 0.5, y: racer.spawn.y, z: racer.spawn.z + 0.5 },
          { dimension: world.getDimension(OVERWORLD) },
        );
        log.info('racerReady', { player: racer.id, x: racer.spawn.x, z: racer.spawn.z });
      } catch (error) {
        log.error('racerSetupFailed', error, { player: racer.id });
      }
    }
  }
}

export function lockMovement(effect: Of<'lockMovement'>, log: Logger): void {
  for (const id of effect.players) {
    const player = online(id);
    if (!player) {
      log.warn('movementLockSkipped', { player: id, locked: effect.locked, reason: 'offline' });
    }
    try {
      player?.inputPermissions.setPermissionCategory(
        InputPermissionCategory.Movement,
        !effect.locked,
      );
    } catch (error) {
      log.error('movementLockFailed', error, { player: id, locked: effect.locked });
    }
  }
}

export function showTitle(effect: Of<'title'>, log: Logger): void {
  for (const id of effect.to) {
    const player = online(id);
    try {
      player?.onScreenDisplay.setTitle(effect.text);
      if (effect.chat) player?.sendMessage(effect.text);
    } catch (error) {
      log.error('titleFailed', error, { player: id });
    }
  }
}

export function broadcast(effect: Of<'broadcast'>): void {
  world.sendMessage(effect.text);
}

/** Shows the rows in the sidebar; entries no longer listed (a team now [OUT]) are removed. */
export function showSidebar(effect: Of<'sidebar'>, log: Logger): void {
  try {
    const { scoreboard } = world;
    const objective = scoreboard.getObjective(OBJECTIVE)
      ?? scoreboard.addObjective(OBJECTIVE, 'Race');
    const wanted = new Set(effect.rows.map((r) => r.name));
    for (const old of objective.getParticipants()) {
      if (!wanted.has(old.displayName)) objective.removeParticipant(old);
    }
    for (const row of effect.rows) objective.setScore(row.name, row.score);
    scoreboard.setObjectiveAtDisplaySlot(DisplaySlotId.Sidebar, { objective });
  } catch (error) {
    log.error('sidebarFailed', error, { rows: effect.rows.length });
  }
}

/**
 * The team's online members: where each stands (one in another dimension has no position there,
 * so counts as not present) and what each carries.
 */
export function teamMembers(session: Session, player: Player): {
  id: string; pos?: Vec3; items: Record<string, number>;
}[] {
  const teamId = session.state?.players[player.id]?.teamId;
  const team = session.state?.teams.find((t) => t.id === teamId);
  return (team?.members ?? [player.id]).flatMap((id) => {
    const member = online(id);
    if (!member) return [];
    return [{
      id,
      pos: member.dimension.id === OVERWORLD ? member.location : undefined,
      items: inventoryCounts(member),
    }];
  });
}

/** A racer used a clue box: tells the core where the team's online members are. */
export function useClueBox(session: Session, player: Player, pos: Vec3): void {
  if (player.dimension.id !== OVERWORLD) return;
  session.dispatch({
    type: 'interactClue', player: player.id, pos, members: teamMembers(session, player),
  });
}
