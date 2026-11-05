// The simulated world of the full-race scenario (technical design §2.9): a flat, empty Overworld
// and scripted players, standing in for src/mc. It runs the real `Session` and the real core, and
// answers every effect the way the adapter would (generation, arenas, the time of day). It proves
// nothing about the adapter itself: that is the in-game checklist's job.
import { RACE } from '../../src/core/config.js';
import { runGeneration } from '../../src/core/course/job.js';
import { Session } from '../../src/core/session.js';
import { LogCapture } from '../helpers/logCapture.js';
import { MapBag } from '../helpers/mapBag.js';

import type { ProbeSource } from '../../src/core/course/job.js';
import type { Probe } from '../../src/core/course/walk.js';
import type {
  Action, Effect, PlayerId, Settings, State,
} from '../../src/core/types.js';
import type { Vec3 } from '../../src/core/vec.js';

type Generate = Extract<Effect, { kind: 'generateCourse' }>;

/** One scripted player: where they stand and what they carry. */
export interface Scripted {
  id: PlayerId;
  name: string;
  pos: Vec3;
  online: boolean;
  items: Record<string, number>;
}

/** Flat ground at y 70 everywhere: every candidate stop is accepted (technical design §2.9). */
const FLAT: ProbeSource = {
  load: async (pos: Vec3): Promise<Probe> => ({
    pos: { ...pos, y: 70 }, terrain: 'plains', spread: 0,
  }),
  pause: async () => undefined,
};

const SPAWN: Vec3 = { x: 0, y: 70, z: 0 };
export const HOST = 'p1';
export const TIME_OF_DAY = 6000;

export class FakeWorld {
  readonly bag = new MapBag();

  readonly log = new LogCapture();

  readonly effects: Effect[] = [];

  readonly players = new Map<PlayerId, Scripted>();

  readonly locked = new Set<PlayerId>();

  /** The menu or form each player was last shown, so a scripted player can pick a button. */
  readonly shown = new Map<PlayerId, Effect>();

  session: Session;

  private pending: Generate[] = [];

  private timeOfDay = TIME_OF_DAY;

  private ticks = 0;

  constructor(private readonly seed = 12345) {
    this.session = this.newSession();
  }

  get state(): State {
    if (!this.session.state) throw new Error('the session has no state');
    return this.session.state;
  }

  /** A fresh Session on the same saved bag: the world closed and opened again. */
  reopen(): void {
    this.session = this.newSession();
    this.session.load();
  }

  load(): void {
    this.session.load();
  }

  join(count: number): void {
    for (let i = 1; i <= count; i += 1) {
      const id = `p${i}`;
      this.players.set(id, {
        id, name: `Player${i}`, pos: { ...SPAWN }, online: true, items: {},
      });
      this.dispatch({
        type: 'playerSpawned', player: id, name: `Player${i}`, initial: true, hasPassport: false,
      });
    }
  }

  online(): Scripted[] {
    return [...this.players.values()].filter((p) => p.online);
  }

  /** The reducer's answer to `action`, refusals included; throws if it was refused. */
  send(action: Action): void {
    if (!this.dispatch(action)) {
      const last = this.log.lines.filter((l) => l.line.includes(' refused ')).pop();
      throw new Error(`refused ${action.type}: ${last?.line ?? 'no log line'}`);
    }
  }

  dispatch(action: Action): boolean {
    return this.session.dispatch(action);
  }

  /** Runs the generation job and the arena builds the effects asked for, as the adapter does. */
  async settle(): Promise<void> {
    while (this.pending.length > 0) {
      const job = this.pending.shift();
      if (!job) break;
      // eslint-disable-next-line no-await-in-loop -- one job at a time, as in the adapter
      const out = await runGeneration({
        start: job.start,
        pins: job.pins,
        legs: job.legs,
        radius: job.radius,
        peaceful: false,
        seed: job.seed,
      }, FLAT);
      if (!out.ok) throw new Error(`course generation failed: ${JSON.stringify(out)}`);
      this.send({
        type: 'courseGenerated',
        job: job.job,
        start: job.start,
        stops: out.stops,
        inserted: out.inserted,
      });
    }
  }

  /** One game tick; the adapter reports positions every `positionTicks` while the race runs. */
  tick(count = 1): void {
    for (let i = 0; i < count; i += 1) {
      this.ticks += 1;
      this.session.onTick(this.ticks);
      if (this.state.phase === 'running' && this.ticks % RACE.positionTicks === 0) this.report();
    }
  }

  /** Setup to the start line: host, settings, teams, generated course, arenas, race started. */
  async begin(count: number, settings: Settings): Promise<void> {
    this.load();
    this.join(count);
    this.send({
      type: 'claimHost', by: HOST, name: 'Player1', via: 'command',
    });
    this.send({ type: 'saveSettings', by: HOST, settings });
    this.send({
      type: 'autoAssignTeams',
      by: HOST,
      players: this.online().map((p) => ({ id: p.id, name: p.name })),
      seed: this.seed,
    });
    this.send({ type: 'startGeneration', by: HOST, start: { ...SPAWN } });
    await this.settle();
    this.send({
      type: 'startRace',
      by: HOST,
      online: this.online().map((p) => p.id),
      snapshot: { rules: { doDaylightCycle: true }, time: this.timeOfDay },
    });
  }

  /** Ticks until `done` holds, at most `limit` ticks; throws if it never does. */
  until(done: () => boolean, limit: number, what: string): void {
    for (let i = 0; i < limit && !done(); i += 1) this.tick();
    if (!done()) {
      throw new Error(`gave up waiting for ${what} after ${limit} ticks`);
    }
  }

  /** Where the online racers stand, sent to the core. */
  report(): void {
    this.session.dispatch({
      type: 'racerPositions',
      players: this.online().map((p) => ({ id: p.id, pos: p.pos })),
    });
  }

  stand(ids: PlayerId[], pos: Vec3): void {
    ids.forEach((id) => {
      const p = this.players.get(id);
      if (p) p.pos = { ...pos };
    });
  }

  /** The time of day the world last had, read back by End day. */
  get clockTime(): number {
    return this.timeOfDay;
  }

  private newSession(): Session {
    const session: Session = new Session({
      bag: this.bag,
      sink: this.log.sink,
      newSeed: () => this.seed,
      execute: (effects) => effects.forEach((e) => this.apply(e, session)),
    });
    return session;
  }

  /** Every effect kind is listed: a new one fails to compile, and a missing handler throws. */
  private apply(e: Effect, session: Session): void {
    this.effects.push(e);
    switch (e.kind) {
      case 'generateCourse':
        this.pending.push(e);
        break;
      case 'buildArenas':
        e.sites.forEach((s) => session.dispatch({
          type: 'arenaBuilt', job: e.job, stop: s.id, y: s.pos.y, existing: false,
        }));
        break;
      case 'teleport':
        this.stand(e.players, e.pos);
        break;
      case 'startRacers':
        e.racers.forEach((r) => this.stand([r.id], r.spawn));
        break;
      case 'lockMovement':
        e.players.forEach((id) => (e.locked ? this.locked.add(id) : this.locked.delete(id)));
        break;
      case 'daylight':
        if (e.time !== undefined) this.timeOfDay = e.time;
        if (e.save) session.dispatch({ type: 'dayTimeSaved', time: this.timeOfDay });
        break;
      case 'taskMenu':
      case 'askQuestion':
        this.shown.set(e.to, e);
        break;
      case 'giveVanilla': {
        const p = this.players.get(e.to);
        if (p) p.items[e.item] = (p.items[e.item] ?? 0) + e.count;
        break;
      }
      case 'takeVanilla': {
        const p = this.players.get(e.from);
        if (p) p.items[e.item] = Math.max(0, (p.items[e.item] ?? 0) - e.count);
        break;
      }
      case 'notify': case 'giveItem': case 'zoneBlocks': case 'spawnTargets': case 'lightStops':
      case 'takeItem': case 'broadcast': case 'title': case 'sidebar': case 'undoPlace':
      case 'clearHusks': case 'restoreWorld': case 'clearSidebar': case 'resetPlayers':
      case 'kitRacer': case 'reward': case 'restore': case 'spectate':
        break;
      default: {
        const never: never = e;
        throw new Error(`fakeWorld cannot apply ${JSON.stringify(never)}`);
      }
    }
  }
}
