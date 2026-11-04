// The shape every challenge shares (technical design §2.7): what it builds, what it gives, how
// its progress moves on a racer's action and when it is done. The engine (race/task.ts) knows
// only "eligible players" and the kind; adding or tuning a challenge touches one file here.
import { TASK } from '../config.js';

import type { TaskKindName } from '../config.js';
import type { Rng } from '../rng.js';
import type {
  Effect, Op, PlayerId, Stop, TaskEvent, TaskProgress, ZoneName,
} from '../types.js';
import type { Vec3 } from '../vec.js';

/** What each player carries: player id to item id to count. */
export type Held = Record<PlayerId, Record<string, number>>;

/** What a kind needs to know about the task being played. */
export interface TaskContext {
  stop: Stop;
  zone: ZoneName;
  /** The zone's centre on the floor (`zonesFor`). */
  centre: Vec3;
  leg: number;
  /** Teams in the race (the haystack hides one wool for each). */
  teams: number;
  /** Haystack: the wool still hidden in this zone. */
  hidden: readonly Vec3[];
  /** The option's name ("Aim") or the kind's name for a Roadblock; prefixes the HUD text. */
  label: string;
  /** The team playing, for the kinds that act on it (Hunt names and tags its husks). */
  team?: { id: string; name: string; color: string };
  /** The seed of the team's question deck at this stop option (Quiz, Recall). */
  deck: number;
  /** Names of the Pit Stops of the legs before this one, in leg order (Recall). */
  pits: string[];
}

/** The blocks of a zone, built once for every team; `hidden` is what the kind keeps hidden. */
export interface ZoneBuild {
  ops: Op[];
  hidden?: Vec3[];
}

export interface TaskKind {
  readonly name: TaskKindName;
  /** Progress when a team starts the task. */
  readonly initial: TaskProgress;
  build: (ctx: TaskContext, rng: Rng) => ZoneBuild;
  /**
   * Gifts for each player who plays (a bow, arrows). With `held` (what each carries now) only
   * what they lack is given.
   */
  equip: (ctx: TaskContext, players: PlayerId[], held?: Held) => Effect[];
  /**
   * What the team needs on entering the task, first or again after a switch (Hunt: its husks,
   * the missing ones only). Unlike `equip` it is the team's, not a player's gear.
   */
  enter?: (progress: TaskProgress, ctx: TaskContext) => Effect[];
  /**
   * The clue-box menu button for what the kind does at the box (Gather: "Hand in"; Quiz and
   * Recall: "Answer questions"). A kind without one acts on the box use itself (a Hunt top-up).
   */
  readonly boxAction?: string;
  /** Returns `progress` itself when the event changes nothing. */
  onEvent: (progress: TaskProgress, event: TaskEvent, ctx: TaskContext) => TaskProgress;
  /**
   * What the world should do about an event, judged against the progress before it: respawn a
   * husk, take handed-in items, say what is missing. Optional; most kinds have no response.
   */
  respond?: (event: TaskEvent, progress: TaskProgress, ctx: TaskContext) => Effect[];
  /** The question form `to` should be shown for `progress` (Quiz, Recall); none for the rest. */
  prompt?: (progress: TaskProgress, ctx: TaskContext, to: PlayerId) => Effect[];
  /** Ticks the team is locked out for after the change from `before` to `after`; 0 for none. */
  lockoutTicks?: (before: TaskProgress, after: TaskProgress, ctx: TaskContext) => number;
  done: (progress: TaskProgress, ctx: TaskContext) => boolean;
  progressText: (progress: TaskProgress, ctx: TaskContext) => string;
}

/** Legs 1 and 2 use the easier numbers, leg 3 onward the harder ones (spec §7.1). */
export const isEarly = (leg: number): boolean => leg <= TASK.earlyLegs;
