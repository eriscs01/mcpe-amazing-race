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
  /** Gifts for each player who plays (a bow, arrows). */
  equip: (ctx: TaskContext, players: PlayerId[]) => Effect[];
  /** Returns `progress` itself when the event changes nothing. */
  onEvent: (progress: TaskProgress, event: TaskEvent, ctx: TaskContext) => TaskProgress;
  done: (progress: TaskProgress, ctx: TaskContext) => boolean;
  progressText: (progress: TaskProgress, ctx: TaskContext) => string;
}

/** Legs 1 and 2 use the easier numbers, leg 3 onward the harder ones (spec §7.1). */
export const isEarly = (leg: number): boolean => leg <= TASK.earlyLegs;
