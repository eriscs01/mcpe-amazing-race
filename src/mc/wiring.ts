// Event subscriptions: translate Minecraft events into core actions and menu openings.
// Menus open from `itemUse` (air) and, as the spec §3 fallback, from using the item on a block.
import { Player, system, world } from '@minecraft/server';

import { hasItem, heldOf } from './items.js';
import { OVERWORLD, useClueBox } from './race.js';
import { wireTaskEvents } from './tasks.js';
import { openHostMenu } from './ui/host.js';
import { openPassport } from './ui/racer.js';
import { parseLightCommand } from '../core/arenas.js';
import { clueBoxAt } from '../core/clue.js';
import { USE_DEBOUNCE_TICKS } from '../core/config.js';
import { guard } from '../core/log.js';
import { routeUse } from '../core/menu.js';

import type { ItemStack, ScriptEventCommandMessageAfterEvent } from '@minecraft/server';

import type { UseRoute } from '../core/menu.js';
import type { Session } from '../core/session.js';

function route(session: Session, player: Player, stack: ItemStack): UseRoute | undefined {
  if (session.loadStatus === 'pending') return undefined;
  const use = { held: heldOf(stack), player: player.id, sneaking: player.isSneaking };
  return routeUse(use, session.state);
}

function wireItemUse(session: Session): void {
  const lastUse = new Map<string, number>();
  const act = async (player: Player, to: UseRoute): Promise<void> => {
    const last = lastUse.get(player.id);
    if (last !== undefined && system.currentTick - last < USE_DEBOUNCE_TICKS) return;
    lastUse.set(player.id, system.currentTick);
    switch (to.kind) {
      case 'hostMenu':
        await openHostMenu(session, player);
        break;
      case 'passport':
        await openPassport(session, player);
        break;
      case 'claimHost':
        session.dispatch({
          type: 'claimHost', by: player.id, name: player.name, via: 'clock',
        });
        break;
      case 'say':
        player.sendMessage(to.text);
        break;
      default: {
        const unknown: never = to;
        throw new Error(`unknown route ${JSON.stringify(unknown)}`);
      }
    }
  };

  world.afterEvents.playerLeave.subscribe(guard(session.log, 'playerLeave', (ev) => {
    lastUse.delete(ev.playerId);
  }));

  world.afterEvents.itemUse.subscribe(guard(session.log, 'itemUse', async (ev) => {
    const to = route(session, ev.source, ev.itemStack);
    if (to) await act(ev.source, to);
  }));

  // Before-event: decide `cancel` from memory only, then act on the next tick.
  world.beforeEvents.playerInteractWithBlock.subscribe(guard(session.log, 'useOnBlock', (ev) => {
    if (!ev.isFirstEvent) return;
    // A clue box wins over the menu fallback: a racer holding the Passport opens one screen.
    const { state } = session;
    const at = ev.block.location; // read now: the block may be gone by the next tick
    const racing = state?.players[ev.player.id]?.teamId !== undefined;
    if (racing && state?.phase === 'running' && ev.block.dimension.id === OVERWORLD
      && clueBoxAt(state, at)) {
      ev.cancel = true; // eslint-disable-line no-param-reassign -- cancelling is the event's API
      const { player } = ev;
      system.run(guard(session.log, 'clueBox', () => useClueBox(session, player, at)));
      return;
    }
    if (!ev.itemStack) return;
    const to = route(session, ev.player, ev.itemStack);
    if (!to) return;
    ev.cancel = true; // eslint-disable-line no-param-reassign -- cancelling is the event's API
    const { player } = ev;
    system.run(guard(session.log, 'useOnBlock', async () => act(player, to)));
  }));
}

function spawned(session: Session, player: Player, initial: boolean): void {
  session.dispatch({
    type: 'playerSpawned',
    player: player.id,
    name: player.name,
    initial,
    hasPassport: hasItem(player, 'passport'),
  });
}

function wireSpawn(session: Session): void {
  world.afterEvents.playerSpawn.subscribe(guard(session.log, 'playerSpawn', (ev) => {
    spawned(session, ev.player, ev.initialSpawn);
  }));
}

/**
 * Called right after load: players who spawned before the state existed (their events were
 * dropped), or are still online after a script reload, are treated as joining now.
 */
export function greetOnlinePlayers(session: Session): void {
  for (const player of world.getPlayers()) spawned(session, player, true);
}

/** `/scriptevent race:<name>` handlers: optional operator backups, never required. */
type ScriptEventHandler = (session: Session, ev: ScriptEventCommandMessageAfterEvent) => void;

const SCRIPT_EVENTS: Record<string, ScriptEventHandler> = {
  'race:host': (session, ev) => {
    const player = ev.sourceEntity;
    if (!(player instanceof Player)) {
      session.log.warn('scriptEventNeedsPlayer', { id: ev.id });
      return;
    }
    session.dispatch({
      type: 'claimHost', by: player.id, name: player.name, via: 'command',
    });
  },
  'race:dump': (session) => session.dumpState(),
  // Before the race lights anything, the host can check a stop's beacon: `race:light 3 on`.
  'race:light': (session, ev) => {
    const player = ev.sourceEntity;
    const wish = parseLightCommand(ev.message);
    if (!(player instanceof Player) || !wish) {
      session.log.warn('lightCommandRejected', { message: ev.message });
      return;
    }
    session.dispatch({ type: 'setLit', ...wish, by: player.id });
  },
};

function wireScriptEvents(session: Session): void {
  system.afterEvents.scriptEventReceive.subscribe(guard(session.log, 'scriptEvent', (ev) => {
    const handler = SCRIPT_EVENTS[ev.id];
    if (handler) handler(session, ev);
    else session.log.warn('unknownScriptEvent', { id: ev.id });
  }), { namespaces: ['race'] });
}

/** Subscribes every handler; call at module top level (Script API 2.0). */
export function wireEvents(session: Session): void {
  wireItemUse(session);
  wireSpawn(session);
  wireScriptEvents(session);
  wireTaskEvents(session);
}
