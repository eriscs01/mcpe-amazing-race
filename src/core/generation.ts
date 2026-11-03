// Course generation (spec §4, §6): the host's landmarks, starting a job, what its result does,
// and discarding a finished course. The job itself runs in the adapter (course/job.ts drives
// the walk); the core only decides what each message changes.
import { COURSE } from './config.js';
import { notify, refuseUnlessHost } from './host.js';
import { planOf } from './plan.js';

import type {
  Action, GenerationFailure, Phase, Result, State, StopType,
} from './types.js';
import type { Vec3 } from './vec.js';

type Of<T extends Action['type']> = Extract<Action, { type: T }>;

/** Landmarks are chosen before the course exists (spec §6.4). */
export const PIN_PHASES: readonly Phase[] = ['setup'];
/** Generate again from ready replaces the course; started races are never regenerated. */
export const GENERATE_PHASES: readonly Phase[] = ['setup', 'ready'];
/** The stop list spoils the course, so it is for the host before the race starts. */
export const LIST_PHASES: readonly Phase[] = ['ready'];
export const DISCARD_PHASES: readonly Phase[] = ['ready'];

const blockOf = (p: Vec3): Vec3 => ({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) });

const STOP_LABEL: Record<StopType, string> = {
  start: 'Start line',
  route: 'Route Info',
  detour: 'Detour',
  roadblock: 'Roadblock',
  pit: 'Pit Stop',
  finish: 'Finish',
};

const stopName = (f: { type: StopType; leg: number }): string => (
  `${STOP_LABEL[f.type]} stop of leg ${f.leg}`);

const ordinal = (pin: number): string => `Landmark ${pin + 1}`;

function grouped(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+$)/g, ',');
}

/** The host-facing message for a failed job: what went wrong and what to change. */
export function failureText(failure: GenerationFailure, radius: number): string {
  switch (failure.reason) {
    case 'tickingAreaFull':
      return 'Course generation needs one free ticking area, but the world already has 10. '
        + 'Remove one (/tickingarea remove) and generate again.';
    case 'pinOutsideCourse':
      return `${ordinal(failure.pin)} is outside the course radius (${grouped(radius)} blocks `
        + 'from the start line). Clear landmarks and add it closer, or stand elsewhere.';
    case 'pinTooClose':
      return `${ordinal(failure.pin)} is closer than ${COURSE.spacing} blocks to the start line `
        + 'or another landmark. Clear landmarks and space them out.';
    case 'tooManyPins':
      return `${ordinal(failure.pin)} does not fit: there are not enough Detour and Roadblock `
        + 'stops for this many landmarks. Clear some landmarks or add legs in Setup.';
    case 'noRoom':
      return `No room for the ${stopName(failure)}: the landmarks leave too little space `
        + 'within the course radius. Move the start line or change the landmarks.';
    case 'noGround':
      return `No usable ground for the ${stopName(failure)} (water or steep terrain everywhere `
        + 'it looked). Move the start line and generate again.';
    default:
      return 'Course generation failed unexpectedly. See the Content Log.';
  }
}

export function addPin(state: State, a: Of<'addPin'>): Result {
  const denied = refuseUnlessHost(state, a.by, PIN_PHASES);
  if (denied) return denied;
  const pos = blockOf(a.pos);
  const pins = [...state.pins, pos];
  return {
    state: { ...state, pins },
    effects: [notify(
      a.by,
      'pinAdded',
      `Landmark ${pins.length} added at ${pos.x}, ${pos.y}, ${pos.z}.`,
    )],
    logs: [{
      event: 'pinAdded',
      fields: {
        n: pins.length, x: pos.x, z: pos.z, by: a.by,
      },
    }],
  };
}

export function clearPins(state: State, a: Of<'clearPins'>): Result {
  const denied = refuseUnlessHost(state, a.by, PIN_PHASES);
  if (denied) return denied;
  return {
    state: { ...state, pins: [] },
    effects: [notify(a.by, 'pinsCleared', 'Landmarks cleared.')],
    logs: [{ event: 'pinsCleared', fields: { was: state.pins.length, by: a.by } }],
  };
}

export function startGeneration(state: State, a: Of<'startGeneration'>): Result {
  const denied = refuseUnlessHost(state, a.by, GENERATE_PHASES);
  if (denied) return denied;
  const job = (state.job ?? 0) + 1;
  const start = blockOf(a.start);
  const { legs, radius } = planOf(state);
  return {
    // Any earlier course stays until the new one arrives, so a failed re-run loses nothing.
    state: { ...state, phase: 'generating', job },
    effects: [{
      kind: 'generateCourse', job, start, pins: state.pins, legs, radius, seed: state.seed,
    }],
    logs: [{
      event: 'generationStarted',
      fields: {
        job, x: start.x, z: start.z, legs, radius, pins: state.pins.length, by: a.by,
      },
    }],
  };
}

const notHostFacing = (state: State, code: string, text: string): Result['effects'] => (
  state.hostId ? [notify(state.hostId, code, text)] : []);

/** A job result counts only for the job in progress; anything else is a late message. */
function staleJob(state: State, job: number): Result | undefined {
  if (state.phase === 'generating' && state.job === job) return undefined;
  return { state, refusal: 'staleJob', effects: [] };
}

export function courseGenerated(state: State, a: Of<'courseGenerated'>): Result {
  const stale = staleJob(state, a.job);
  if (stale) return stale;
  return {
    state: {
      ...state, phase: 'ready', start: a.start, stops: a.stops,
    },
    effects: notHostFacing(
      state,
      'courseReady',
      `Course ready: ${a.stops.length} stops. Use List stops to see them.`,
    ),
    logs: [{
      event: 'courseGenerated',
      fields: { job: a.job, stops: a.stops.length, inserted: a.inserted },
    }],
  };
}

export function courseFailed(state: State, a: Of<'courseFailed'>): Result {
  const stale = staleJob(state, a.job);
  if (stale) return stale;
  const kept = state.stops.length > 0;
  return {
    state: { ...state, phase: kept ? 'ready' : 'setup' },
    effects: notHostFacing(state, 'generationFailed', failureText(a.failure, planOf(state).radius)),
    logs: [{ event: 'courseFailed', fields: { job: a.job, ...a.failure, kept } }],
  };
}

export function discardCourse(state: State, a: Of<'discardCourse'>): Result {
  const denied = refuseUnlessHost(state, a.by, DISCARD_PHASES);
  if (denied) return denied;
  const { start, ...rest } = state;
  return {
    // Landmarks and teams stay; settings can change again.
    state: { ...rest, phase: 'setup', stops: [] },
    effects: [notify(a.by, 'courseDiscarded', 'Course discarded. Settings can change again.')],
    logs: [{ event: 'courseDiscarded', fields: { stops: state.stops.length, by: a.by } }],
  };
}

/** The List stops screen (spec §4): leg, stop type, place name and coordinates, one per line. */
export function stopList(state: State): string {
  if (state.stops.length === 0) return 'No course yet. Use Generate course here.';
  return state.stops.map((s) => {
    const { x, y, z } = s.pos;
    const leg = s.type === 'start' ? 'Start' : `Leg ${s.leg}`;
    const landmark = s.landmark ? ` (${s.landmark.kind})` : '';
    return `${leg} · ${STOP_LABEL[s.type]} · ${s.name}${landmark} · ${x}, ${y}, ${z}`;
  }).join('\n');
}
