// Tells the core where the online racers are (technical design §2.4). A racer in another
// dimension is reported without a position, which keeps their team off the mat.
import { world } from '@minecraft/server';

import { OVERWORLD } from './race.js';

import type { Session } from '../core/session.js';

export function reportPositions(session: Session): void {
  if (session.state?.phase !== 'running') return;
  const players = world.getAllPlayers()
    .filter((p) => p.isValid && session.state?.players[p.id]?.teamId !== undefined)
    .map((p) => ({
      id: p.id,
      pos: p.dimension.id === OVERWORLD ? p.location : undefined,
      gliding: p.isGliding,
    }));
  session.dispatch({ type: 'racerPositions', players });
}
