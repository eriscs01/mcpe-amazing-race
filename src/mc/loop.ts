// The single game-tick loop (technical design §2.4): advances the race clock and runs the
// periodic systems through the session.
import { system } from '@minecraft/server';

import { showHud } from './hud.js';
import { retryLights } from './lighting.js';
import { reportPositions } from './positions.js';
import { sweepItems, sweepMobs } from './protect.js';
import {
  ARENA, HUD, RACE, RULES,
} from '../core/config.js';
import { guard } from '../core/log.js';

import type { Session } from '../core/session.js';

export function startLoop(session: Session): void {
  system.runInterval(guard(session.log, 'tick', () => session.onTick(system.currentTick)), 1);
  // Lights wait for their chunks to load (spec §6.6).
  const retry = guard(session.log, 'lightRetry', () => retryLights(session));
  system.runInterval(retry, ARENA.retryTicks);
  // The racer HUD: action bar every 5 ticks, the particle trail on every fourth refresh.
  let refreshes = 0;
  const hud = guard(session.log, 'hud', () => {
    refreshes += 1;
    showHud(session, refreshes % (HUD.trailEveryTicks / HUD.everyTicks) === 0);
  });
  system.runInterval(hud, HUD.everyTicks);
  // Where the racers are: the core decides Pit Stop arrival (and later the rules) from it.
  const positions = guard(session.log, 'positions', () => reportPositions(session));
  system.runInterval(positions, RACE.positionTicks);
  // The rules' sweeps (spec §7.4, §9.4): hostile mobs in lit arenas, elytra and ender pearls.
  system.runInterval(
    guard(session.log, 'mobSweep', () => sweepMobs(session)),
    RULES.sweep.mobTicks,
  );
  system.runInterval(
    guard(session.log, 'itemSweep', () => sweepItems(session)),
    RULES.sweep.itemTicks,
  );
}
