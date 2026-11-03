// Host menu (spec §4): shows the phase-aware model from core and runs the chosen command.
import { world } from '@minecraft/server';
import { ModalFormData } from '@minecraft/server-ui';

import { showForm, showMenu } from './forms.js';
import { hostMenu } from '../../core/menu.js';

import type { Player } from '@minecraft/server';

import type { HostCommand } from '../../core/menu.js';
import type { Session } from '../../core/session.js';

async function transferHost(session: Session, player: Player): Promise<void> {
  const others = world.getPlayers().filter((p) => p.id !== player.id);
  if (others.length === 0) {
    player.sendMessage('No other players are online.');
    return;
  }
  const form = new ModalFormData()
    .title('Transfer host')
    .dropdown('New host', others.map((p) => p.name));
  const response = await showForm(player, async (p) => form.show(p), session.log, 'Transfer host');
  const index = response?.formValues?.[0];
  const target = typeof index === 'number' ? others[index] : undefined;
  if (!target) return;
  if (!target.isValid) {
    player.sendMessage(`${target.name} has left.`);
    return;
  }
  session.dispatch({
    type: 'transferHost', by: player.id, to: target.id, toName: target.name,
  });
}

const COMMANDS: Record<HostCommand, (session: Session, player: Player) => Promise<void>> = {
  transferHost,
};

export async function openHostMenu(session: Session, player: Player): Promise<void> {
  const command = await showMenu(player, hostMenu(session.state), session.log);
  if (command !== undefined) await COMMANDS[command](session, player);
}
