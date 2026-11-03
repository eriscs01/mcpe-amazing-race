// Holds the live race state and connects the reducer to persistence and the world: load on
// world start, dispatch actions, hand effects to the adapter, save on change and periodically.
import { ADDON_VERSION, SAVE_EVERY_TICKS } from './config.js';
import { Logger } from './log.js';
import { loadState, saveState } from './persist.js';
import { reduce } from './race/engine.js';
import { createState } from './state.js';

import type { Sink } from './log.js';
import type { PropertyBag } from './persist.js';
import type { Action, Effect, State } from './types.js';

export interface SessionDeps {
  bag: PropertyBag;
  sink: Sink;
  /** Applies effects to the world (the adapter's executor). */
  execute: (effects: Effect[]) => void;
  /** Seed for a new race; the only randomness the core takes from outside. */
  newSeed: () => number;
}

export type LoadStatus = 'pending' | 'ready' | 'unreadable';

/** Characters of state JSON per `stateDumpPart` line, short enough for one Content Log entry. */
export const DUMP_PART_CHARS = 2000;

export class Session {
  /** Undefined until loaded, and for good if the save could not be read. */
  state: State | undefined;

  readonly log: Logger;

  private status: LoadStatus = 'pending';

  /** A change that must be saved before the tick ends. */
  private dirty = false;

  /** Only the clock moved; saved with the next periodic save. */
  private clockMoved = false;

  private saveFailing = false;

  private droppedLogged = false;

  constructor(private readonly deps: SessionDeps) {
    this.log = new Logger(deps.sink, () => ({ clock: this.state?.clock }));
  }

  /** `unreadable` keeps the add-on idle; the host menu explains why. */
  get loadStatus(): LoadStatus {
    return this.status;
  }

  load(): void {
    const result = loadState(this.deps.bag);
    if (result.kind === 'corrupt') {
      this.status = 'unreadable';
      // Leave the stored chunks untouched and stay idle; never overwrite them with a new race.
      this.log.error('loadFailed', new Error('saved race state is unreadable'), {
        reason: result.reason,
        version: ADDON_VERSION,
      });
      return;
    }
    const fresh = result.kind === 'empty';
    const state = fresh ? createState(this.deps.newSeed()) : result.state;
    this.state = state;
    this.status = 'ready';
    this.log.info('loaded', {
      version: ADDON_VERSION,
      schema: state.v,
      source: fresh ? 'new' : 'saved',
      phase: state.phase,
      seed: state.seed,
    });
    if (state.phase === 'running') {
      // The world closed mid-race: racers reconnect over time, so the host resumes explicitly.
      this.state = { ...state, phase: 'paused' };
      this.log.warn('pausedOnLoad');
    }
    if (state.phase === 'generating') {
      // The job died with the world: nothing will report back, so the host starts it again.
      const phase = state.stops.length > 0 ? 'ready' : 'setup';
      this.state = { ...state, phase };
      this.log.warn('generationAbandonedOnLoad', { job: state.job, to: phase });
    }
    this.dirty = fresh || this.state !== state;
    this.flush();
  }

  /** Returns whether the action was accepted (false when refused or there is no state). */
  dispatch(action: Action): boolean {
    const { state } = this;
    if (!state) {
      if (action.type !== 'tick' && !this.droppedLogged) {
        this.log.warn('droppedNoState', { action: action.type });
        this.droppedLogged = true;
      }
      return false;
    }
    const out = reduce(state, action);
    if (out.refusal) {
      this.log.warn('refused', {
        code: out.refusal,
        action: action.type,
        by: 'by' in action ? action.by : undefined,
      });
    } else if (out.state.phase !== state.phase) {
      this.log.info('phaseChanged', {
        from: state.phase,
        to: out.state.phase,
        by: 'by' in action ? action.by : undefined,
      });
    }
    if (out.state.hostId !== state.hostId) {
      this.log.info('hostChanged', { from: state.hostId, to: out.state.hostId, via: action.type });
    }
    for (const line of out.logs ?? []) this.log.info(line.event, line.fields);
    this.state = out.state;
    if (out.state !== state) {
      if (action.type === 'tick' && out.effects.length === 0) this.clockMoved = true;
      else this.dirty = true;
    }
    this.deps.execute(out.effects);
    // Saved at once (spec §13); a failing save waits for the periodic retry instead.
    if (!this.saveFailing) this.flush();
    return out.refusal === undefined;
  }

  /** Called once per game tick by the adapter's loop with `system.currentTick`. */
  onTick(tick: number): void {
    if (!this.state) return;
    this.dispatch({ type: 'tick' });
    if (tick % SAVE_EVERY_TICKS !== 0) return;
    // Periodic save: the moved clock, and the retry of a save that failed.
    if (this.clockMoved) this.dirty = true;
    this.flush();
  }

  /**
   * Read-only diagnosis (`/scriptevent race:dump`): a summary line, then the state JSON in parts.
   * Joined in order, the parts' `json` values (log-quoted ones decoded) are the state.
   */
  dumpState(): void {
    const { state } = this;
    if (!state) {
      this.log.info('stateDump', { status: this.status });
      return;
    }
    const json = JSON.stringify(state);
    const parts = Math.ceil(json.length / DUMP_PART_CHARS);
    this.log.info('stateDump', {
      phase: state.phase,
      host: state.hostId,
      teams: state.teams.length,
      stops: state.stops.length,
      parts,
    });
    for (let i = 0; i < parts; i += 1) {
      const slice = json.slice(i * DUMP_PART_CHARS, (i + 1) * DUMP_PART_CHARS);
      this.log.info('stateDumpPart', { part: i + 1, of: parts, json: slice });
    }
  }

  private flush(): void {
    const { state } = this;
    if (!this.dirty || !state) return;
    try {
      saveState(this.deps.bag, state);
    } catch (err) {
      if (!this.saveFailing) this.log.error('saveFailed', err);
      this.saveFailing = true;
      return;
    }
    if (this.saveFailing) this.log.info('saveRecovered');
    this.saveFailing = false;
    this.dirty = false;
    this.clockMoved = false;
  }
}
