// The arena builder (spec §6.5): builds the arenas of a course one at a time, each in a job of
// its own across game ticks, loading the stop with a ticking area first. Reports every arena to
// the core. A stop whose arena already stands (a re-run, #32) is recognised, not built again.
/* eslint-disable no-await-in-loop -- arenas are built one after another */
import {
  Player, system, world,
} from '@minecraft/server';

import { DimensionWorld } from './blockWorld.js';
import { TickingAreaLoader } from './terrainProbe.js';
import {
  applyOps, buildOps, looksBuilt,
} from '../core/arena/layout.js';
import { ARENA } from '../core/config.js';
import { TickingAreaFull } from '../core/course/job.js';

import type { Session } from '../core/session.js';
import type { ArenaFailure, ArenaSite, Effect } from '../core/types.js';

type BuildEffect = Extract<Effect, { kind: 'buildArenas' }>;

/** Runs a generator as a job and resolves when it ends (or rejects if it throws). */
async function runToEnd(steps: Generator<void>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    system.runJob((function* job(): Generator<void> {
      try {
        yield* steps;
        resolve();
      } catch (error) {
        reject(error);
      }
    }()));
  });
}

/** The newest request not started yet; it replaces an older one (it names every missing arena). */
let pending: BuildEffect | undefined;
let running = false;

/** The course this build is for is still the one waiting to start, and this arena is missing. */
function wanted(session: Session, job: number, id: number): boolean {
  const { state } = session;
  return state?.phase === 'ready' && state.job === job
    && state.stops.some((s) => s.id === id && !s.built);
}

function progress(session: Session, k: number, total: number): void {
  const host = session.state?.hostId;
  const player = host ? world.getEntity(host) : undefined;
  if (player instanceof Player && player.isValid) {
    player.onScreenDisplay.setActionBar(`Building arena ${k}/${total}…`);
  }
}

async function buildOne(
  session: Session,
  loader: TickingAreaLoader,
  job: number,
  site: ArenaSite,
): Promise<'next' | 'stop'> {
  const fail = (reason: ArenaFailure): void => {
    session.dispatch({
      type: 'arenaBuildFailed', job, stop: site.id, reason,
    });
  };
  try {
    if (!await loader.ensureLoaded(site.pos)) {
      fail('timeout');
      return 'next';
    }
    const target = new DimensionWorld(world.getDimension('overworld'));
    const found = looksBuilt((x, y, z) => target.idAt(x, y, z), site.pos);
    if (found === undefined) await runToEnd(applyOps(target, buildOps(site)));
    session.dispatch({
      type: 'arenaBuilt', job, stop: site.id, y: found ?? site.pos.y, existing: found !== undefined,
    });
    return 'next';
  } catch (error) {
    if (error instanceof TickingAreaFull) {
      fail('tickingAreaFull');
      return 'stop';
    }
    session.log.error('arenaBuildError', error, { job, stop: site.id });
    fail('error');
    return 'next';
  }
}

async function buildAll(session: Session, effect: BuildEffect): Promise<void> {
  const { job, sites } = effect;
  const dimension = world.getDimension('overworld');
  const loader = new TickingAreaLoader(dimension, session.log, ARENA.areaName);
  session.log.info('arenaBuildStarted', { job, arenas: sites.length });
  try {
    for (let i = 0; i < sites.length; i += 1) {
      const site = sites[i];
      // A newer request, a new course or a discard ends this one.
      if (!site || pending || !wanted(session, job, site.id)) break;
      progress(session, i + 1, sites.length);
      if (await buildOne(session, loader, job, site) === 'stop') break;
    }
  } finally {
    loader.close();
  }
}

/** Queues a build request; at most one build runs at a time. */
export async function startArenaBuild(session: Session, effect: BuildEffect): Promise<void> {
  pending = effect;
  if (running) return;
  running = true;
  try {
    while (pending) {
      const next = pending;
      pending = undefined;
      await buildAll(session, next);
    }
  } finally {
    running = false;
  }
}
