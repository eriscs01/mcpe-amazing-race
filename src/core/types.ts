// Persisted race state (technical design §2.3) and the actions and effects that cross the
// core/adapter boundary. Everything in State is plain JSON so it survives the chunked store.
import type { DetourOption, RoadblockKind, Terrain } from './config.js';
import type { Fields } from './log.js';
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

/**
 * The challenge a stop holds (spec §7.3): a Detour's two options, or a Roadblock's kind. Names
 * and kinds are stored, not table indexes, so a save stays readable if the tables change. The
 * task groups add each kind's parameters.
 */
export type TaskSpec = { type: 'detour'; options: [DetourOption, DetourOption] }
  | { type: 'roadblock'; kind: RoadblockKind };

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
  /** Placed on a host-pinned waypoint (spec §6.4). */
  pinned?: boolean;
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

/** The script-tagged vanilla items (spec §3). */
export type MenuItemRole = 'raceControl' | 'passport';

/** Inputs to the core reducer. Later groups add cases; the reducer's switch is exhaustive. */
export type Action = { type: 'tick' }
  | { type: 'setPhase'; to: Phase; by?: PlayerId }
  /** `initial` is the first spawn of a session (a join), not a respawn. */
  | {
    type: 'playerSpawned'; player: PlayerId; name: string; initial: boolean; hasPassport: boolean;
  }
  /** `clock`: sneak-using a plain clock; `command`: `/scriptevent race:host`. */
  | {
    type: 'claimHost'; by: PlayerId; name: string; via: 'clock' | 'command';
  }
  | {
    type: 'transferHost'; by: PlayerId; to: PlayerId; toName: string;
  }
  | { type: 'saveSettings'; by: PlayerId; settings: Settings }
  /** `players`: everyone online; `seed` drives the shuffle and is logged to reproduce it. */
  | {
    type: 'autoAssignTeams'; by: PlayerId; players: { id: PlayerId; name: string }[]; seed: number;
  }
  | {
    type: 'swapPlayers'; by: PlayerId; a: PlayerId; b: PlayerId;
  };

/** What the adapter must do in the world. */
export type Effect = { kind: 'notify'; to: PlayerId; code: string; text: string }
  | { kind: 'giveItem'; to: PlayerId; item: MenuItemRole }
  /** Removes every copy of the item from the player's inventory. */
  | { kind: 'takeItem'; from: PlayerId; item: MenuItemRole };

/** An outcome line for the Content Log; the session adds the race clock. */
export interface LogLine {
  event: string;
  fields: Fields;
}

export interface Result {
  /** Stable code when the action was refused; state is then unchanged. */
  refusal?: string;
  state: State;
  effects: Effect[];
  /** Outcome lines of an accepted action (debuggability: one line per outcome). */
  logs?: LogLine[];
}
