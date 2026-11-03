// Racer HUD display (spec §9.1): reads each online player's view for the core's hudFrames and
// shows the frames on the action bar and as particles only that player sees.
import { MolangVariableMap, world } from '@minecraft/server';

import { OVERWORLD } from './race.js';
import { PARTICLE } from '../core/config.js';
import { hudFrames } from '../core/hud.js';

import type { Player } from '@minecraft/server';

import type { HudFrame, HudView } from '../core/hud.js';
import type { Session } from '../core/session.js';

/** A display that keeps failing would log every frame; log the first failure until it recovers. */
const failing = new Set<string>();

function guarded(session: Session, kind: string, player: Player, show: () => void): void {
  const key = `${kind}:${player.id}`;
  try {
    show();
    failing.delete(key);
  } catch (error) {
    if (failing.has(key)) return;
    failing.add(key);
    const team = session.state?.players[player.id]?.teamId;
    session.log.warn('hudFailed', {
      kind, player: player.id, team, leg: session.state?.leg.n, error: String(error),
    });
  }
}

const viewOf = (player: Player): HudView => ({
  id: player.id,
  head: player.getHeadLocation(),
  yaw: player.getRotation().y,
  overworld: player.dimension.id === OVERWORLD,
});

function display(session: Session, player: Player, frame: HudFrame): void {
  guarded(session, 'actionbar', player, () => player.onScreenDisplay.setActionBar(frame.text));
  frame.trail?.forEach((point) => guarded(session, 'trail', player, () => (
    player.spawnParticle(PARTICLE.trail, point, new MolangVariableMap())
  )));
}

/** One HUD refresh; `trail` is true on every fourth (every 20 ticks). */
export function showHud(session: Session, trail: boolean): void {
  const { state } = session;
  if (state?.phase !== 'running') return;
  // One player whose position cannot be read must not blank everyone else's HUD.
  const players = world.getAllPlayers().filter((p) => p.isValid);
  const views = players.flatMap((p) => {
    try {
      const view = viewOf(p);
      failing.delete(`view:${p.id}`);
      return [view];
    } catch (error) {
      guarded(session, 'view', p, () => {
        throw error;
      });
      return [];
    }
  });
  const frames = hudFrames(state, views, { trail });
  // Forget a player's failures once they leave, so the set does not grow.
  const here = new Set(players.map((p) => `:${p.id}`));
  failing.forEach((key) => {
    if (!here.has(key.slice(key.indexOf(':')))) failing.delete(key);
  });
  frames.forEach((frame) => {
    const player = players.find((p) => p.id === frame.to);
    if (player) display(session, player, frame);
  });
}
