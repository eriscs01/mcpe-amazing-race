// Form plumbing (technical design §2.8): one open form per player, UserBusy retry, cancelled
// forms ignored, and core menu models rendered as action forms.
import { system } from '@minecraft/server';
import { ActionFormData, FormCancelationReason } from '@minecraft/server-ui';

import { FORM_RETRY_TICKS, FORM_TRIES } from '../../core/config.js';
import { retryWhileBusy } from '../../core/retry.js';

import type { Player } from '@minecraft/server';
import type { FormResponse } from '@minecraft/server-ui';

import type { Logger } from '../../core/log.js';
import type { Menu } from '../../core/menu.js';

/** Players with a form open or waiting to open; a second request is ignored meanwhile. */
const openFor = new Set<string>();

/** Shows a form; resolves undefined when it was closed, or the player stayed busy for 5 s. */
export async function showForm<R extends FormResponse>(
  player: Player,
  show: (player: Player) => Promise<R>,
  log: Logger,
  form: string,
): Promise<R | undefined> {
  if (openFor.has(player.id)) {
    log.info('formIgnored', { player: player.id, form, reason: 'alreadyOpen' });
    return undefined;
  }
  openFor.add(player.id);
  try {
    const response = await retryWhileBusy(
      async () => show(player),
      (r) => r.canceled && r.cancelationReason === FormCancelationReason.UserBusy,
      async () => system.waitTicks(FORM_RETRY_TICKS),
      FORM_TRIES,
    );
    if (response === undefined) {
      log.warn('formGaveUp', { player: player.id, form, reason: 'busy' });
      if (player.isValid) player.sendMessage('Close chat and try again.');
    }
    return response?.canceled ? undefined : response;
  } finally {
    openFor.delete(player.id);
  }
}

/** Shows a menu model; resolves the chosen button's command, or undefined. */
export async function showMenu<C>(
  player: Player,
  menu: Menu<C>,
  log: Logger,
): Promise<C | undefined> {
  const form = new ActionFormData().title(menu.title).body(menu.body);
  for (const button of menu.buttons) form.button(button.label);
  if (menu.buttons.length === 0) form.button('Close');
  const response = await showForm(player, async (p) => form.show(p), log, menu.title);
  const { selection } = response ?? {};
  return selection === undefined ? undefined : menu.buttons[selection]?.command;
}
