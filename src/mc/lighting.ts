// Stop lighting (spec §6.6): applies lit/unlit changes to the world, retrying every 2 seconds
// until the stop's chunk can be written. The queue is memory only; the core re-requests every
// light when the world loads.
import {
  LocationInUnloadedChunkError, UnloadedChunksError, world,
} from '@minecraft/server';

import { DimensionWorld } from './blockWorld.js';
import { applyOps, lightOps } from '../core/arena/layout.js';
import { RetryQueue } from '../core/arena/lighting.js';

import type { Session } from '../core/session.js';
import type { ArenaSite, Effect } from '../core/types.js';

type Wish = ArenaSite & { lit: boolean };

const isUnloaded = (error: unknown): boolean => (
  error instanceof LocationInUnloadedChunkError || error instanceof UnloadedChunksError);

const queue = new RetryQueue<Wish>();

function apply(target: DimensionWorld, site: Wish): boolean {
  try {
    Array.from(applyOps(target, lightOps(site, site.lit)));
    return true;
  } catch (error) {
    if (isUnloaded(error)) return false;
    throw error;
  }
}

/** One round of attempts; the loop calls it every `ARENA.retryTicks`. */
export function retryLights(session: Session): void {
  if (queue.size === 0) return;
  const target = new DimensionWorld(world.getDimension('overworld'));
  queue.drain((site, tries) => {
    const current = session.state?.stops.find((s) => s.id === site.id);
    const moved = current?.pos.x !== site.pos.x || current?.pos.z !== site.pos.z;
    if (moved || current?.type !== site.type) {
      // The course changed since this was queued; the stop is not where or what it was.
      session.log.info('lightsDropped', { stop: site.id });
      return true;
    }
    const { x, z } = site.pos;
    // A block that reads as undefined is in a chunk that is not loaded.
    const loaded = target.idAt(x, site.pos.y + 1, z) !== undefined;
    if (!loaded || !apply(target, site)) {
      if (tries === 1) session.log.info('lightsDeferred', { stop: site.id, lit: site.lit });
      return false;
    }
    session.log.info('lightsApplied', { stop: site.id, lit: site.lit, tries });
    return true;
  }, (site, error) => session.log.error('lightsFailed', error, { stop: site.id, lit: site.lit }));
}

type LightEffect = Extract<Effect, { kind: 'lightStops' }>;

/** Queues the effect's changes and tries them at once. */
export function lightStops(session: Session, effect: LightEffect): void {
  effect.sites.forEach((site) => queue.set(site));
  retryLights(session);
}
