// Generation job (spec §6.1): drives the course walk across game ticks. The world is behind a
// ProbeSource (the adapter's terrain probe); this module owns the protocol, so it is tested
// with a fake source and no Minecraft.
/* eslint-disable no-await-in-loop -- each step must finish before the walk is resumed */
import { generateCourse, PAUSE } from './walk.js';

import type { CourseInput, CourseOutcome, Probe } from './walk.js';
import type { Vec3 } from '../vec.js';

export interface ProbeSource {
  /** Loads the area around `pos` and probes it; undefined = rejected or timed out. */
  load: (pos: Vec3) => Promise<Probe | undefined>;
  /** Waits one game tick, so long searches do not overrun it. */
  pause: () => Promise<void>;
}

/** The world has no room for the scan's ticking area: the host must remove one. */
export class TickingAreaFull extends Error {
  constructor() {
    super('ticking area limit reached');
    this.name = 'TickingAreaFull';
  }
}

export type JobOutcome = CourseOutcome | { ok: false; reason: 'tickingAreaFull' };

/**
 * Runs the walk to the end. Other errors from the source propagate: the caller logs them and
 * fails the generation.
 */
export async function runGeneration(input: CourseInput, source: ProbeSource): Promise<JobOutcome> {
  const steps = generateCourse(input);
  try {
    let step = steps.next();
    while (!step.done) {
      let answer: Probe | undefined;
      if (step.value === PAUSE) await source.pause();
      else answer = await source.load(step.value);
      step = steps.next(answer);
    }
    return step.value;
  } catch (error) {
    if (error instanceof TickingAreaFull) return { ok: false, reason: 'tickingAreaFull' };
    throw error;
  }
}
