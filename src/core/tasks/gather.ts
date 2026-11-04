// Gather (spec §7.1, §7.2): the stop's terrain says what to bring; the team's pooled inventory
// is handed in at the clue box and exactly the required count is removed.
import { GATHER } from '../config.js';

import type { TaskKind } from './kind.js';
import type { PlayerId } from '../types.js';

type Requirement = (typeof GATHER)[keyof typeof GATHER];
type Held = Record<PlayerId, Record<string, number>>;

export interface HandIn {
  /** The required items the team holds, all members together. */
  have: number;
  enough: boolean;
  /** What to remove: members in order, accepted items in order, `count` in all; empty if short. */
  takes: { from: PlayerId; item: string; count: number }[];
}

/** The one place that decides a hand-in, so the progress and the removal cannot disagree. */
export function handIn(held: Held, required: Requirement): HandIn {
  const stock = Object.entries(held).map(([from, items]) => ({
    from,
    counts: required.items.map((item) => ({ item, n: items[item] ?? 0 })),
  }));
  const have = stock.reduce((sum, m) => sum + m.counts.reduce((s, c) => s + c.n, 0), 0);
  if (have < required.count) return { have, enough: false, takes: [] };
  let left = required.count;
  const takes = stock.flatMap(({ from, counts }) => counts.flatMap(({ item, n }) => {
    const count = Math.min(n, left);
    left -= count;
    return count > 0 ? [{ from, item, count }] : [];
  }));
  return { have, enough: true, takes };
}

export const gather: TaskKind = {
  name: 'gather',
  initial: { handedIn: 0 },
  build: () => ({ ops: [] }),
  equip: () => [],
  onEvent: (progress, event, ctx) => (
    event.type === 'boxUsed' && handIn(event.held, GATHER[ctx.stop.terrain]).enough
      ? { handedIn: 1 } : progress),
  respond: (event, _progress, ctx) => {
    if (event.type !== 'boxUsed') return [];
    const required = GATHER[ctx.stop.terrain];
    const out = handIn(event.held, required);
    if (out.enough) return out.takes.map((t) => ({ kind: 'takeVanilla', ...t }));
    return [{
      kind: 'notify',
      to: event.by,
      code: 'handIn',
      text: `${ctx.label}: you hold ${out.have} of ${required.count} ${required.label}.`,
    }];
  },
  done: (progress) => (progress.handedIn ?? 0) >= 1,
  progressText: (_progress, ctx) => {
    const required = GATHER[ctx.stop.terrain];
    return `${ctx.label}: hand in ${required.count} ${required.label} at the clue box`;
  },
};
