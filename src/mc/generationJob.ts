// The generation job (spec §6.1): runs the course walk across game ticks with the terrain probe,
// shows progress to the host and reports the outcome to the core. One job at a time.
import {
  Difficulty, Player, system, world,
} from '@minecraft/server';

import { TickingAreaLoader } from './terrainProbe.js';
import { runGeneration } from '../core/course/job.js';
import { scanCandidate } from '../core/course/scan.js';

import type { ProbeSource } from '../core/course/job.js';
import type { Session } from '../core/session.js';
import type { Effect, GenerationFailure } from '../core/types.js';

type GenerateEffect = Extract<Effect, { kind: 'generateCourse' }>;

let running = false;

/** The host's action bar; it fades after about 3 s, so it is sent again before each probe. */
function progressBar(session: Session): {
  stop: (placed: number, total: number) => void;
  show: () => void;
} {
  const host = session.state?.hostId;
  let text = 'Generating course…';
  const show = (): void => {
    const player = host ? world.getEntity(host) : undefined;
    if (player instanceof Player && player.isValid) player.onScreenDisplay.setActionBar(text);
  };
  return {
    stop: (placed, total) => {
      text = `Generating stop ${Math.min(placed + 1, total)}/${total}…`;
      show();
    },
    show,
  };
}

async function run(session: Session, effect: GenerateEffect): Promise<void> {
  const { job } = effect;
  const loader = new TickingAreaLoader(world.getDimension('overworld'), session.log);
  const bar = progressBar(session);
  const source: ProbeSource = {
    load: async (pos) => {
      bar.show();
      return scanCandidate(pos, loader, effect.seed);
    },
    pause: async () => {
      bar.show();
      return system.waitTicks(1);
    },
  };
  const started = system.currentTick;
  try {
    const outcome = await runGeneration({
      start: effect.start,
      pins: effect.pins,
      legs: effect.legs,
      radius: effect.radius,
      peaceful: world.getDifficulty() === Difficulty.Peaceful,
      seed: effect.seed,
      onStop: bar.stop,
    }, source);
    session.log.info('generationFinished', {
      job, ok: outcome.ok, ticks: system.currentTick - started,
    });
    if (outcome.ok) {
      const { stops, inserted } = outcome;
      session.dispatch({
        type: 'courseGenerated', job, start: effect.start, stops, inserted,
      });
      return;
    }
    const { ok, ...failure } = outcome;
    session.dispatch({ type: 'courseFailed', job, failure: failure as GenerationFailure });
  } catch (error) {
    session.log.error('generationFailed', error, { job });
    session.dispatch({ type: 'courseFailed', job, failure: { reason: 'error' } });
  } finally {
    loader.close();
  }
}

/** Starts the job for a generateCourse effect, unless one is already running. */
export async function startGenerationJob(session: Session, effect: GenerateEffect): Promise<void> {
  if (running) {
    session.log.warn('generationAlreadyRunning', { job: effect.job });
    return;
  }
  running = true;
  try {
    await run(session, effect);
  } finally {
    running = false;
  }
}
