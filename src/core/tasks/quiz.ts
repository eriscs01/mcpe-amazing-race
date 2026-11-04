// Quiz (spec §7.1): answer every question right in a clue-box form. Questions are drawn from the
// team's deck (`quiz/bank.ts`), one per form; a wrong answer locks the team out and uses the
// question up, so the next one is a fresh draw. Progress is just two counters, so it persists.
import { TASK, TICKS_PER_SECOND } from '../config.js';
import { isCorrect, questionAt } from '../quiz/bank.js';

import type { TaskContext, TaskKind } from './kind.js';
import type { TaskProgress } from '../types.js';

/** Questions this stop asks: a Roadblock's three, a Detour's four. */
export const quizCount = (ctx: TaskContext): number => (
  ctx.stop.type === 'roadblock' ? TASK.quiz.roadblock : TASK.quiz.detour);

const answered = (progress: TaskProgress): number => progress.answered ?? 0;
const wrong = (progress: TaskProgress): number => progress.wrong ?? 0;
/** Which question of the deck is being asked: every answer, right or wrong, uses one. */
const seqOf = (progress: TaskProgress): number => answered(progress) + wrong(progress);

export const quiz: TaskKind = {
  name: 'quiz',
  initial: { answered: 0, wrong: 0 },
  build: () => ({ ops: [] }),
  equip: () => [],
  onEvent: (progress, event, ctx) => {
    if (event.type !== 'answered' || event.seq !== seqOf(progress)) return progress;
    const text = event.values[0];
    const right = typeof text === 'string'
      && isCorrect(questionAt(ctx.deck, event.seq), text);
    return right
      ? { ...progress, answered: answered(progress) + 1 }
      : { ...progress, wrong: wrong(progress) + 1 };
  },
  prompt: (progress, ctx, to) => {
    const seq = seqOf(progress);
    const { prompt } = questionAt(ctx.deck, seq);
    return [{
      kind: 'askQuestion',
      to,
      stopId: ctx.stop.id,
      option: ctx.zone,
      seq,
      title: ctx.label,
      body: `Question ${answered(progress) + 1} of ${quizCount(ctx)}`,
      fields: [{ type: 'text', label: prompt, placeholder: 'Your answer' }],
    }];
  },
  lockoutTicks: (before, after) => (
    wrong(after) > wrong(before) ? TASK.quiz.lockoutSeconds * TICKS_PER_SECOND : 0),
  done: (progress, ctx) => answered(progress) >= quizCount(ctx),
  progressText: (progress, ctx) => (
    `${ctx.label}: question ${Math.min(answered(progress) + 1, quizCount(ctx))}/${quizCount(ctx)}`),
};
