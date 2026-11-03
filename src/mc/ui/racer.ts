// Race Passport (spec §3): the racer's own menu, rendered from the core model.
import { showMenu } from './forms.js';
import { passportMenu } from '../../core/menu.js';

import type { Player } from '@minecraft/server';

import type { Session } from '../../core/session.js';

export async function openPassport(session: Session, player: Player): Promise<void> {
  const { state } = session;
  if (state) await showMenu(player, passportMenu(state, player.id), session.log);
}
