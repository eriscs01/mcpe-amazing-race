// The single game-tick loop (technical design §2.4): advances the race clock and runs the
// periodic systems through the session.
import { system } from '@minecraft/server';

import { showHud } from './hud.js';
import { retryLights } from './lighting.js';
import { ARENA, HUD } from '../core/config.js';
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
}
