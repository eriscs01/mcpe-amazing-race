// Start race (spec §8.1, §4): the host confirms that racer inventories will be cleared, then the
// start is dispatched with who is online and the world's current rules.
import { world } from '@minecraft/server';

import { showMenu } from './forms.js';
import { readSnapshot } from '../race.js';

import type { Player } from '@minecraft/server';

import type { Menu } from '../../core/menu.js';
import type { Session } from '../../core/session.js';

const CONFIRM: Menu<'yes' | 'no'> = {
  title: 'Start race',
  body: 'Racer inventories will be cleared and every racer is teleported to the start line. '
    + 'Movement stays locked for a 10 second countdown.',
  buttons: [{ command: 'yes', label: 'Start' }, { command: 'no', label: 'Cancel' }],
};

const CONFIRM_END_LEG: Menu<'yes' | 'no'> = {
  title: 'End leg now',
  body: 'Teams not yet checked in are placed last; the last team is eliminated or gets a '
    + 'Speed Bump. Penalties still owed are added to its departure.',
  buttons: [{ command: 'yes', label: 'End leg' }, { command: 'no', label: 'Cancel' }],
};

export async function endLeg(session: Session, player: Player): Promise<void> {
  if (await showMenu(player, CONFIRM_END_LEG, session.log) !== 'yes') return;
  session.dispatch({ type: 'endLeg', by: player.id });
}

export async function startRace(session: Session, player: Player): Promise<void> {
  if (await showMenu(player, CONFIRM, session.log) !== 'yes') return;
  session.dispatch({
    type: 'startRace',
    by: player.id,
    online: world.getPlayers().map((p) => p.id),
    snapshot: readSnapshot(),
  });
}
