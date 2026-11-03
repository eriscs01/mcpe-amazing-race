// Persisted race state (technical design §2.3) and the actions and effects that cross the
// core/adapter boundary. Everything in State is plain JSON so it survives the chunked store.
import type { TaskKindName, Terrain } from './config.js';
import type { Vec3 } from './vec.js';

/** Bumped only for a change that old saves cannot be read as; additive fields keep it. */
export const SCHEMA_VERSION = 1;

export type Phase = 'setup' | 'generating' | 'ready' | 'running' | 'paused' | 'dayEnded'
  | 'finished';

/** `player.id`, the only player identity that is persisted. */
export type PlayerId = string;

export interface Settings {
  days: number;
  minutesPerDay: number;
  teamSize: number;
  hostRaces: boolean;
  daylightCycle: boolean;
}

export interface Plan {
  legs: number;
  legsPerDay: number;
  radius: number;
  eliminationLegs: number[];
}

export type StopType = 'start' | 'route' | 'detour' | 'roadblock' | 'pit' | 'finish';

export interface Landmark {
  kind: string;
  pos: Vec3;
}

/** A challenge placed at a stop; its parameters are added by the task groups. */
export interface TaskSpec {
  kind: TaskKindName;
}

/** Per-team, per-option task progress; each task kind defines its own counters. */
export type TaskProgress = Record<string, number>;

export interface Stop {
  id: number;
  leg: number;
  type: StopType;
  pos: Vec3;
  terrain: Terrain;
  name: string;
  landmark?: Landmark;
  blind: boolean;
  task?: TaskSpec;
  built: boolean;
  lit: boolean;
}

export interface CheckIn {
  leg: number;
  clock: number;
  place: number;
}

export interface Team {
  id: string;
  name: string;
  color: string;
  members: PlayerId[];
  status: 'racing' | 'checkedIn' | 'eliminated';
  leg: number;
  /** Index into the leg's stops. */
  step: number;
  /** Race clock ticks still to serve. */
  penaltyOwed: number;
  checkIns: CheckIn[];
  roadblockCounts: Record<PlayerId, number>;
  performer?: PlayerId;
  expressPass?: { expiresLeg: number };
  uTurnUsed: boolean;
  uTurnedAt?: number;
  speedBump: boolean;
  /** Key: `${stopId}:${option}`. */
  progress: Record<string, TaskProgress>;
  departAt?: number;
  lastClearedStop: number;
  lockoutUntil?: number;
}

export interface PlayerRecord {
  name: string;
  teamId?: string;
  lastPos?: Vec3;
  inBoundsPos?: Vec3;
  savedPos?: Vec3;
}

export interface LegState {
  n: number;
  phase: 'racing' | 'grace' | 'rest' | 'departing';
  graceEnd?: number;
  restEnd?: number;
}

export interface State {
  v: typeof SCHEMA_VERSION;
  hostId?: PlayerId;
  phase: Phase;
  seed: number;
  settings: Settings;
  plan?: Plan;
  /** Race clock: ticks counted only while the race runs (spec §11). */
  clock: number;
  day: number;
  dayStartClock: number;
  snapshot?: { rules: Record<string, boolean>; time: number };
  start?: Vec3;
  pins: Vec3[];
  stops: Stop[];
  teams: Team[];
  players: Record<PlayerId, PlayerRecord>;
  leg: LegState;
}

/** Inputs to the core reducer. Later groups add cases; the reducer's switch is exhaustive. */
export type Action = { type: 'tick' }
  | { type: 'setPhase'; to: Phase; by?: PlayerId };

/** What the adapter must do in the world. */
export interface Effect { kind: 'notify'; to: PlayerId; code: string; text: string }

export interface Result {
  /** Stable code when the action was refused; state is then unchanged. */
  refusal?: string;
  state: State;
  effects: Effect[];
}
