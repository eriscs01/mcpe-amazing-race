// Hunt (spec §7.1): husks named for the team and tagged for it, spawned at the zone centre when
// the team starts. A kill by an eligible racer counts; a husk that dies to anyone else is
// respawned, so the husks alive are always the total minus the kills.
import { TASK } from '../config.js';
import { isEarly } from './kind.js';

import type { TaskContext, TaskKind } from './kind.js';
import type { Effect, ZoneName } from '../types.js';

const PREFIX = 'hunt';

/** The tag a team's husks carry at a stop's zone: the core reads it back from `entityDie`. */
export const huntTag = (team: string, stop: number, zone: ZoneName): string => (
  [PREFIX, team, stop, zone].join(':'));

interface HuntTag { team: string; stop: number; zone: ZoneName }

export function parseHuntTag(tag: string): HuntTag | undefined {
  const [prefix, team, stop, zone, ...rest] = tag.split(':');
  const id = Number(stop);
  if (prefix !== PREFIX || !team || rest.length > 0 || !/^\d+$/.test(stop ?? '')) return undefined;
  return zone === 'A' || zone === 'B' ? { team, stop: id, zone } : undefined;
}

const total = (leg: number): number => (isEarly(leg) ? TASK.hunt.early : TASK.hunt.late);

const spawn = (ctx: TaskContext, count: number, topUp: boolean): Effect[] => (
  ctx.team ? [{
    kind: 'spawnTargets',
    tag: huntTag(ctx.team.id, ctx.stop.id, ctx.zone),
    name: `${ctx.team.color}${ctx.team.name} Target§r`,
    at: { x: ctx.centre.x, y: ctx.centre.y + 1, z: ctx.centre.z },
    count,
    topUp,
  }] : []);

export const hunt: TaskKind = {
  name: 'hunt',
  initial: { kills: 0 },
  // The husks belong to one team, so they are spawned at its start, not with the shared zone.
  build: () => ({ ops: [] }),
  equip: () => [],
  // Only the missing husks: a start has none alive, a switch back keeps the kills.
  enter: (progress, ctx) => spawn(ctx, total(ctx.leg) - (progress.kills ?? 0), true),
  onEvent: (progress, event) => (
    event.type === 'targetKilled' ? { kills: (progress.kills ?? 0) + 1 } : progress),
  respond: (event, progress, ctx) => {
    if (event.type === 'targetLost') return spawn(ctx, 1, false);
    // Using the box again brings back husks lost without a death (void, unload, a command).
    if (event.type === 'boxUsed') return spawn(ctx, total(ctx.leg) - (progress.kills ?? 0), true);
    return [];
  },
  done: (progress, ctx) => (progress.kills ?? 0) >= total(ctx.leg),
  progressText: (progress, ctx) => `${ctx.label}: targets ${progress.kills ?? 0}/${total(ctx.leg)}`,
};
