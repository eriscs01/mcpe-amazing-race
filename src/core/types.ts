// Persisted race state (technical design §2.3) and the actions and effects that cross the
// core/adapter boundary. Everything in State is plain JSON so it survives the chunked store.
import type {
  BlockId, DetourOption, RoadblockKind, TaskKindName, Terrain,
} from './config.js';
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

/** A task zone of a Detour or Roadblock stop (spec §6.5): A is the west half, B the east. */
export type ZoneName = 'A' | 'B';

/** A block operation of an arena or task build; the adapter runs it against the world. */
export type Op = | {
  kind: 'fill'; from: Vec3; to: Vec3; block: BlockId; only?: readonly BlockId[];
}
  | { kind: 'set'; pos: Vec3; block: BlockId }
  /** Air from `fromY` up to the topmost block of the column, so the beam is not blocked. */
  | { kind: 'clearColumn'; x: number; z: number; fromY: number };

/** What a zone holds once its task is set up; shared by every team that plays there. */
export interface ZoneState {
  kind: TaskKindName;
  /** Haystack: where the hidden wool still is. */
  hidden?: Vec3[];
  /** Haystack: how many times the pile has been rebuilt (varies the seeded wool draw). */
  refills?: number;
}

/** What a racer did that a task may care about (spec §7.1). */
export type TaskEvent = { type: 'projectileHit'; block: Vec3; shooter: Vec3 }
  | { type: 'blockBroken'; block: Vec3; id: string }
  | { type: 'standing'; pos: Vec3 };

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
  /** Task zones already set up (read with `??`: absent in older saves). */
  zones?: Partial<Record<ZoneName, ZoneState>>;
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
  /** The task the team is playing now (read with `??`); `option` picks the Detour zone. */
  task?: { stopId: number; option: 'A' | 'B' };
  expressPass?: { expiresLeg: number };
  uTurnUsed: boolean;
  uTurnedAt?: number;
  speedBump: boolean;
  /** Key: `${stopId}:${option}`. */
  progress: Record<string, TaskProgress>;
  /** Race clock when every online member stood on the Pit Stop mat (spec §8.4). */
  arrivedAt?: number;
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
  snapshot?: RaceSnapshot;
  start?: Vec3;
  /** Id of the newest generation job; a result for any other job is stale. */
  job?: number;
  pins: Vec3[];
  stops: Stop[];
  teams: Team[];
  players: Record<PlayerId, PlayerRecord>;
  leg: LegState;
  /** The final leg's winner (spec §8.4), and the race clock at which the race ends regardless. */
  winner?: string;
  finishEnd?: number;
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
  }
  /** Host: the position becomes a mandatory waypoint (spec §6.4). */
  | { type: 'addPin'; by: PlayerId; pos: Vec3 }
  | { type: 'clearPins'; by: PlayerId }
  /** Host: `start` is the host's position, the start line. */
  | { type: 'startGeneration'; by: PlayerId; start: Vec3 }
  /** From the adapter's generation job, which carries the id it was started with. */
  | {
    type: 'courseGenerated'; job: number; start: Vec3; stops: Stop[]; inserted: number;
  }
  | { type: 'courseFailed'; job: number; failure: GenerationFailure }
  | { type: 'discardCourse'; by: PlayerId }
  /** Host: builds the arenas still missing (after a failure). */
  | { type: 'buildArenas'; by: PlayerId }
  /**
   * From the adapter's arena builder, with the job of the course it built for. `y` is the
   * arena's real ground height; `existing` says it was found already standing, not built.
   */
  | {
    type: 'arenaBuilt'; job: number; stop: number; y: number; existing: boolean;
  }
  | { type: 'arenaBuildFailed'; job: number; stop: number; reason: ArenaFailure }
  /**
   * Which stops show a beacon (spec §6.6). Without `by` it comes from the race rules; with it,
   * from the host's debug command.
   */
  | { type: 'setLit'; stops: number[] | 'all'; lit: boolean; by?: PlayerId }
  /**
   * Host: starts the race (spec §8.1). `online` are the players in the world; `snapshot` is the
   * gamerules and time of day as the world has them now, kept for the end of the race.
   */
  | {
    type: 'startRace'; by: PlayerId; online: PlayerId[]; snapshot: RaceSnapshot;
  }
  /**
   * A racer used a stop's clue box (spec §8.2). `members` are the team's online members; one
   * without `pos` is in another dimension.
   */
  | {
    type: 'interactClue'; player: PlayerId; pos: Vec3; members: { id: PlayerId; pos?: Vec3 }[];
  }
  /**
   * Where the online racers are, sent by the adapter on an interval. One without `pos` is in
   * another dimension. The core decides what it means (Pit Stop arrival; later, the rules).
   */
  | { type: 'racerPositions'; players: { id: PlayerId; pos?: Vec3 }[] }
  /** Host: ends the leg now (spec §8.5). */
  | { type: 'endLeg'; by: PlayerId }
  /** A racer's action a task may count (a shot, a broken block); the core decides if it does. */
  | { type: 'taskEvent'; player: PlayerId; event: TaskEvent }
  /** The adapter could not build a task zone: forget it so the next box use rebuilds it. */
  | { type: 'zoneBuildFailed'; stop: number; zone: ZoneName };

/** The world's settings before the race changed them (restored when it ends, spec §12). */
export interface RaceSnapshot {
  rules: Record<string, boolean>;
  time: number;
}

export type ArenaFailure = 'timeout' | 'tickingAreaFull' | 'error';

/** A stop's arena: where it stands and what kind of stop it is (which sets its colours). */
export interface ArenaSite {
  id: number;
  pos: Vec3;
  type: StopType;
}

/** Why a generation job ended without a course. */
export type GenerationFailure = {
  reason: 'noGround' | 'noRoom'; stop: number; leg: number; type: StopType;
} | {
  reason: 'pinOutsideCourse' | 'pinTooClose' | 'tooManyPins'; pin: number;
} | { reason: 'tickingAreaFull' } | { reason: 'error' };

/** What the adapter must do in the world. */
export type Effect = { kind: 'notify'; to: PlayerId; code: string; text: string }
  | { kind: 'giveItem'; to: PlayerId; item: MenuItemRole }
  /** Gives a plain vanilla item (a task's bow and arrows). */
  | { kind: 'giveVanilla'; to: PlayerId; item: string; count: number }
  /** Builds a task zone's blocks; the team is standing there, so the chunks are loaded. */
  | { kind: 'zoneBlocks'; stop: number; zone: ZoneName; ops: Op[] }
  /** Starts the generation job; the adapter reports back with courseGenerated or courseFailed. */
  | {
    kind: 'generateCourse';
    job: number;
    start: Vec3;
    pins: Vec3[];
    legs: number;
    radius: number;
    seed: number;
  }
  /** Builds the arenas one at a time; each is reported with arenaBuilt or arenaBuildFailed. */
  | { kind: 'buildArenas'; job: number; sites: ArenaSite[] }
  /** Makes these stops lit or unlit, retrying until their chunks can be written (spec §6.6). */
  | { kind: 'lightStops'; sites: (ArenaSite & { lit: boolean })[] }
  /** Removes every copy of the item from the player's inventory. */
  | { kind: 'takeItem'; from: PlayerId; item: MenuItemRole }
  /**
   * Race start (spec §8.1 steps 1-4): sets the rules and time, then for each racer clears the
   * inventory, gives the kit, sets Survival, colours the name tag and teleports to `spawn`.
   */
  | {
    kind: 'startRacers';
    racers: { id: PlayerId; name: string; color: string; spawn: Vec3 }[];
    daylight: boolean;
    time: number;
  }
  /** Locks or unlocks the players' movement (the start countdown). */
  | { kind: 'lockMovement'; players: PlayerId[]; locked: boolean }
  | { kind: 'broadcast'; text: string }
  /** A title on the players' screens; with `chat` the text is also sent to their chat. */
  | { kind: 'title'; to: PlayerId[]; text: string; chat?: boolean }
  /** Replaces the public sidebar scoreboard (spec §10). */
  | { kind: 'sidebar'; rows: SidebarRow[] }
  /** Moves the players to `pos` (the Overworld). */
  | { kind: 'teleport'; players: PlayerId[]; pos: Vec3 }
  /** The leg winner's reward (spec §8.4): experience levels and a firework at `at`. */
  | { kind: 'reward'; to: PlayerId[]; levels: number; at: Vec3 }
  /** Heals and feeds the players (the rest between legs, spec §8.5). */
  | { kind: 'restore'; players: PlayerId[] }
  /** Puts the players in Spectator mode (an eliminated team, spec §8.5). */
  | { kind: 'spectate'; players: PlayerId[] };

export interface SidebarRow {
  name: string;
  score: number;
}

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
