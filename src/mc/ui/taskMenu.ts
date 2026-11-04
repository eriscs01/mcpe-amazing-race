// The clue-box menu of a Detour or Roadblock (spec §8.2, technical design §2.8): shows the core's
// `taskMenu` and sends the chosen button back as `taskChoice`, with the team's inventories as
// they are now. What each button means, and whether it still applies, is decided in core.
import { showMenu } from './forms.js';
import { online } from '../online.js';
import { teamMembers } from '../race.js';

import type { Session } from '../../core/session.js';
import type { Effect } from '../../core/types.js';

export async function showTaskMenu(
  session: Session,
  effect: Extract<Effect, { kind: 'taskMenu' }>,
): Promise<void> {
  const { log } = session;
  const player = online(effect.to);
  if (!player) {
    log.warn('menuSkipped', { player: effect.to, stop: effect.stopId, reason: 'offline' });
    return;
  }
  const choice = await showMenu(player, effect.menu, log);
  if (!choice) {
    log.info('menuClosed', { player: effect.to, stop: effect.stopId });
    return;
  }
  session.dispatch({
    type: 'taskChoice',
    player: effect.to,
    stopId: effect.stopId,
    choice,
    members: teamMembers(session, player),
  });
}
