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
  try {
    show();
    failing.delete(kind);
  } catch (error) {
    if (failing.has(kind)) return;
    failing.add(kind);
    session.log.warn('hudFailed', { kind, player: player.id, error: String(error) });
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
  const players = world.getAllPlayers().filter((p) => p.isValid);
  const frames = hudFrames(state, players.map(viewOf), { trail });
  frames.forEach((frame) => {
    const player = players.find((p) => p.id === frame.to);
    if (player) display(session, player, frame);
  });
}
