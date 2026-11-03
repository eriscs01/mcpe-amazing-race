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
import { buildStep } from '../core/arenas.js';
import { ARENA } from '../core/config.js';
import { TickingAreaFull } from '../core/course/job.js';

import type { Session } from '../core/session.js';
import type {
  ArenaFailure, ArenaSite, Effect, State,
} from '../core/types.js';

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

function progress(session: Session, k: number, total: number): void {
  const host = session.state?.hostId;
  const player = host ? world.getEntity(host) : undefined;
  if (player instanceof Player && player.isValid) {
    player.onScreenDisplay.setActionBar(`Building arena ${k}/${total}…`);
  }
}

/** Passes the build's steps through until the course changes under it. */
function* whileWanted(steps: Generator<void>, keep: () => boolean): Generator<void> {
  for (const step of steps) {
    if (!keep()) return;
    yield step;
  }
}

/** Builds (or recognises) one arena; the y of its floor, or undefined if the course changed. */
async function buildOne(
  session: Session,
  loader: TickingAreaLoader,
  job: number,
  site: ArenaSite,
): Promise<{ y: number; existing: boolean } | undefined> {
  const keep = (): boolean => buildStep(session.state as State, job, site.id) === 'build';
  if (!await loader.ensureLoaded(site.pos) || !keep()) return undefined;
  const target = new DimensionWorld(world.getDimension('overworld'));
  const found = looksBuilt((x, y, z) => target.idAt(x, y, z), site.pos);
  if (found === undefined) await runToEnd(whileWanted(applyOps(target, buildOps(site)), keep));
  // Nothing was written for a course that changed meanwhile, or only part of it.
  if (!keep()) return undefined;
  return { y: found ?? site.pos.y, existing: found !== undefined };
}

/** Builds one site and reports it to the core; false ends the whole build. */
async function buildSite(
  session: Session,
  loader: TickingAreaLoader,
  job: number,
  site: ArenaSite,
): Promise<boolean> {
  const fail = (reason: ArenaFailure): void => {
    session.dispatch({
      type: 'arenaBuildFailed', job, stop: site.id, reason,
    });
  };
  let outcome: Awaited<ReturnType<typeof buildOne>>;
  try {
    outcome = await buildOne(session, loader, job, site);
  } catch (error) {
    if (error instanceof TickingAreaFull) {
      fail('tickingAreaFull');
      return false;
    }
    session.log.error('arenaBuildError', error, { job, stop: site.id });
    fail('error');
    return true;
  }
  if (outcome) {
    session.dispatch({
      type: 'arenaBuilt', job, stop: site.id, y: outcome.y, existing: outcome.existing,
    });
  } else if (session.state && buildStep(session.state, job, site.id) === 'build') {
    fail('timeout');
  }
  return true;
}

async function buildAll(session: Session, effect: BuildEffect): Promise<void> {
  const { job, sites } = effect;
  const dimension = world.getDimension('overworld');
  const loader = new TickingAreaLoader(dimension, session.log, ARENA.areaName);
  session.log.info('arenaBuildStarted', { job, arenas: sites.length });
  try {
    for (let i = 0; i < sites.length; i += 1) {
      const site = sites[i];
      const step = site && session.state ? buildStep(session.state, job, site.id) : 'stop';
      // A newer request or a changed course ends this one; a finished arena is just skipped.
      if (!site || pending || step === 'stop') break;
      if (step === 'build') {
        progress(session, i + 1, sites.length);
        if (!await buildSite(session, loader, job, site)) break;
      }
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
      try {
        await buildAll(session, next);
      } catch (error) {
        // A request that arrived meanwhile still runs.
        session.log.error('arenaBuildAborted', error, { job: next.job });
      }
    }
  } finally {
    running = false;
  }
}
