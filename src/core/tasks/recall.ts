// Recall (spec §7.1, final Roadblock only): one dropdown for each earlier leg, each listing every
// Pit Stop name; the team must match every leg to its Pit Stop. A wrong submission locks the team
// out and reshuffles the lists. The dropdowns are rebuilt from the deck seed, so a form only
// sends the chosen indexes and the core decides what they mean.
import { TASK, TICKS_PER_SECOND } from '../config.js';
import { Rng } from '../rng.js';

import type { TaskContext, TaskKind } from './kind.js';
import type { TaskProgress } from '../types.js';

const answered = (progress: TaskProgress): number => progress.answered ?? 0;
const wrong = (progress: TaskProgress): number => progress.wrong ?? 0;
const seqOf = (progress: TaskProgress): number => answered(progress) + wrong(progress);

/** The Pit Stop names as the dropdowns list them for question `seq`. */
export const recallOptions = (ctx: TaskContext, seq: number): string[] => (
  new Rng((ctx.deck + seq * 104729) % 4294967296).shuffle(ctx.pits));

export const recall: TaskKind = {
  name: 'recall',
  initial: { answered: 0, wrong: 0 },
  build: () => ({ ops: [] }),
  equip: () => [],
  onEvent: (progress, event, ctx) => {
    if (event.type !== 'answered' || event.seq !== seqOf(progress)) return progress;
    const options = recallOptions(ctx, event.seq);
    const matched = ctx.pits.every((pit, leg) => {
      const pick = event.values[leg];
      return typeof pick === 'number' && options[pick] === pit;
    });
    return matched
      ? { ...progress, answered: answered(progress) + 1 }
      : { ...progress, wrong: wrong(progress) + 1 };
  },
  prompt: (progress, ctx, to) => {
    const seq = seqOf(progress);
    return [{
      kind: 'askQuestion',
      to,
      stopId: ctx.stop.id,
      option: ctx.zone,
      seq,
      title: ctx.label,
      body: 'Which Pit Stop did you check in at, leg by leg?',
      fields: ctx.pits.map((_, leg) => ({
        type: 'dropdown' as const,
        label: `Leg ${leg + 1}`,
        options: recallOptions(ctx, seq),
      })),
    }];
  },
  lockoutTicks: (before, after) => (
    wrong(after) > wrong(before) ? TASK.recall.lockoutSeconds * TICKS_PER_SECOND : 0),
  done: (progress) => answered(progress) >= 1,
  progressText: (_progress, ctx) => `${ctx.label}: match each leg to its Pit Stop`,
};
