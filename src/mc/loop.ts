// The single game-tick loop (technical design §2.4): advances the race clock and runs the
// periodic systems through the session.
import { system } from '@minecraft/server';

import { guard } from '../core/log.js';

import type { Session } from '../core/session.js';

export function startLoop(session: Session): void {
  system.runInterval(guard(session.log, 'tick', () => session.onTick(system.currentTick)), 1);
}
