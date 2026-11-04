// Question forms (spec §7.1, technical design §2.8): shows the core's `askQuestion` as a modal
// form and sends the raw answer back as `submitAnswer`. Which answer is right, and what a wrong
// one costs, is decided in core; a closed form simply asks nothing (the box asks again).
import { ModalFormData } from '@minecraft/server-ui';

import { showForm } from './forms.js';
import { answerValues } from '../../core/quiz/form.js';
import { online } from '../online.js';

import type { Session } from '../../core/session.js';
import type { Effect } from '../../core/types.js';

export async function askQuestion(
  session: Session,
  effect: Extract<Effect, { kind: 'askQuestion' }>,
): Promise<void> {
  const { log } = session;
  const fields = { player: effect.to, stop: effect.stopId, seq: effect.seq };
  const player = online(effect.to);
  if (!player) {
    log.warn('askSkipped', { ...fields, reason: 'offline' });
    return;
  }
  const form = new ModalFormData().title(`${effect.title}: ${effect.body}`);
  for (const field of effect.fields) {
    if (field.type === 'text') form.textField(field.label, field.placeholder);
    else form.dropdown(field.label, field.options);
  }
  form.submitButton('Answer');
  log.info('questionAsked', fields);
  const response = await showForm(player, async (p) => form.show(p), log, effect.title);
  if (!response) return;
  const values = answerValues(effect.fields, response.formValues);
  if (!values) {
    log.warn('formUnreadable', {
      ...fields, form: effect.title, values: JSON.stringify(response.formValues),
    });
    player.sendMessage('The question form could not be read. Use the clue box to try again.');
    return;
  }
  session.dispatch({
    type: 'submitAnswer',
    player: effect.to,
    stopId: effect.stopId,
    option: effect.option,
    seq: effect.seq,
    values,
  });
}
