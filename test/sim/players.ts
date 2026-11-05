// A scripted team for the full-race scenario: it walks to the clue box, picks the menu buttons a
// player would, solves the task with the same actions the adapter reports, and stands on the
// mat. Every action goes through the real reducer; a refusal throws with the log line.
import { zonesFor } from '../../src/core/arena/layout.js';
import { clueBoxPos, legStops, matCentre } from '../../src/core/clue.js';
import { BLOCK, GATHER, ITEM } from '../../src/core/config.js';
import { deckSeed, questionAt } from '../../src/core/quiz/bank.js';
import { archeryTargets } from '../../src/core/tasks/archery.js';
import { huntTag } from '../../src/core/tasks/hunt.js';
import { parkourCourse } from '../../src/core/tasks/parkour.js';

import type { FakeWorld } from './fakeWorld.js';
import type { TaskKindName } from '../../src/core/config.js';
import type { TaskContext } from '../../src/core/tasks/kind.js';
import type {
  Effect, PlayerId, Stop, TaskChoice, Team, ZoneName,
} from '../../src/core/types.js';
import type { Vec3 } from '../../src/core/vec.js';

type Ask = Extract<Effect, { kind: 'askQuestion' }>;

/** How a team plays a stop; whatever it leaves out, it does the obvious thing. */
export interface Plan {
  /** Detour: the side to start with (default A). */
  option?: ZoneName;
  /** Roadblock: who performs (default: the first the menu offers). */
  performer?: PlayerId;
  /** Give up the task with the quit penalty instead of solving it. */
  quit?: boolean;
  /** Spend the Express Pass on the stop's Detour or Roadblock. */
  express?: boolean;
  /** Detour (legs 2..L-1): U-Turn this team, if the board offers it. */
  uturn?: string;
}

const kindOf = (stop: Stop, option: ZoneName): TaskKindName => {
  const { task } = stop;
  if (task?.type === 'detour') {
    const picked = task.options[option === 'A' ? 0 : 1];
    if (!picked) throw new Error(`stop ${stop.id} has no option ${option}`);
    return picked.kind;
  }
  if (task?.type === 'roadblock') return task.kind;
  throw new Error(`stop ${stop.id} has no task`);
};

export class Bot {
  constructor(private readonly w: FakeWorld, readonly id: string) {}

  get team(): Team {
    const found = this.w.state.teams.find((t) => t.id === this.id);
    if (!found) throw new Error(`no team ${this.id}`);
    return found;
  }

  get online(): PlayerId[] {
    return this.team.members.filter((m) => this.w.players.get(m)?.online);
  }

  /** Who uses the box: the Roadblock's performer once chosen, else the first member. */
  private get lead(): PlayerId {
    const { performer } = this.team;
    const who = performer && this.online.includes(performer) ? performer : this.online[0];
    if (!who) throw new Error(`team ${this.id} has nobody online`);
    return who;
  }

  /** The stop the team is heading for. */
  get target(): Stop {
    const stop = legStops(this.w.state, this.team.leg)[this.team.step];
    if (!stop) throw new Error(`team ${this.id} has no target`);
    return stop;
  }

  private members(): { id: PlayerId; pos: Vec3; items: Record<string, number> }[] {
    return this.online.flatMap((id) => {
      const p = this.w.players.get(id);
      return p ? [{ id, pos: p.pos, items: p.items }] : [];
    });
  }

  /** Walks everyone online to `pos`. */
  walk(pos: Vec3): void {
    this.w.stand(this.online, pos);
  }

  /** Walks to the Pit Stop or Finish mat and waits for the check-in (or its penalty wait). */
  toMat(): void {
    const stop = this.target;
    this.walk(matCentre(stop));
    this.w.report();
  }

  /** Uses the clue box of the target; returns the menu or form the player was shown. */
  click(): Effect | undefined {
    const stop = this.target;
    const { lead } = this;
    this.w.shown.delete(lead);
    this.walk(clueBoxPos(stop));
    this.w.send({
      type: 'interactClue', player: lead, pos: clueBoxPos(stop), members: this.members(),
    });
    return this.w.shown.get(lead);
  }

  /** A menu button; the button must be on the menu the player was last shown. */
  choose(choice: TaskChoice, player = this.lead): void {
    const shown = this.w.shown.get(player);
    if (shown?.kind === 'taskMenu') {
      const offered = (shown).menu.buttons.some(
        (b) => JSON.stringify(b.command) === JSON.stringify(choice),
      );
      if (!offered) {
        throw new Error(`${choice.type} is not on ${this.id}'s menu: ${(shown).menu.buttons
          .map((b) => b.command.type).join(', ')}`);
      }
    }
    this.w.shown.delete(player);
    this.w.send({
      type: 'taskChoice', player, stopId: this.target.id, choice, members: this.members(),
    });
  }

  /** The buttons of the menu the lead was last shown. */
  buttons(): TaskChoice[] {
    const shown = this.w.shown.get(this.lead);
    return shown?.kind === 'taskMenu' ? shown.menu.buttons.map((b) => b.command) : [];
  }

  /** Plays the stop the team is at until the team has moved on. */
  play(plan: Plan = {}): void {
    const stop = this.target;
    const before = this.team.step;
    const steps = stop.task?.type === 'detour' ? 4 : 2;
    this.click();
    for (let i = 0; i < steps * 3 && this.team.step === before; i += 1) {
      if (!this.team.task) this.start(stop, plan);
      else if (plan.quit) this.quit();
      else this.solve(stop, this.team.task.option);
      if (this.team.step === before && !this.team.task && stop.task?.type === 'detour') {
        this.click();
      }
    }
    if (this.team.step === before) throw new Error(`team ${this.id} is stuck at stop ${stop.id}`);
  }

  private start(stop: Stop, plan: Plan): void {
    const kind = stop.task?.type;
    if (plan.express) {
      // The U-Turn board comes first on a Detour where one could be played.
      if (this.buttons().some((b) => b.type === 'noUturn')) this.choose({ type: 'noUturn' });
      this.choose(kind === 'detour' && this.team.uTurnedAt === stop.id
        ? { type: 'expressPass', option: 'A' } : { type: 'expressPass' });
      return;
    }
    if (plan.uturn && this.buttons().some((b) => b.type === 'uturn')) {
      this.choose({ type: 'uturn', team: plan.uturn });
      return;
    }
    if (kind === 'detour') {
      if (this.buttons().some((b) => b.type === 'noUturn')) this.choose({ type: 'noUturn' });
      // A U-Turned team plays both sides: the one it has not begun yet.
      const fresh = (['A', 'B'] as const).find((o) => !this.team.progress[`${stop.id}:${o}`]);
      this.choose({ type: 'option', option: plan.option ?? fresh ?? 'A' });
      return;
    }
    if (kind === 'roadblock') {
      const performers = this.buttons().flatMap((b) => (b.type === 'perform' ? [b.who] : []));
      const who = plan.performer ?? performers[0];
      if (!who) throw new Error(`no performer on ${this.id}'s menu`);
      this.choose({ type: 'perform', who });
      return;
    }
    // Route Info with a Speed Bump: the quiz begins when the box says so.
    if (this.buttons().some((b) => b.type === 'start')) this.choose({ type: 'start' });
    else this.solve(stop, 'A');
  }

  private quit(): void {
    this.click();
    this.choose({ type: 'quit' });
    this.choose({ type: 'confirmQuit' });
  }

  private context(stop: Stop, option: ZoneName): TaskContext {
    const { state } = this.w;
    const zone = zonesFor(stop.type, stop.pos).find((z) => z.zone === option);
    return {
      stop,
      zone: option,
      centre: zone?.centre ?? stop.pos,
      leg: stop.leg,
      teams: state.teams.length,
      hidden: stop.zones?.[option]?.hidden ?? [],
      label: '',
      deck: deckSeed(state.seed, this.id, stop.id, option),
      pits: state.stops.filter((s) => s.type === 'pit' && s.leg < stop.leg)
        .sort((a, b) => a.leg - b.leg || a.id - b.id).map((s) => s.name),
    };
  }

  /** Eligible players: the performer on a Roadblock, everyone on a Detour. */
  private players(stop: Stop): PlayerId[] {
    return stop.task?.type === 'roadblock' && this.team.performer
      ? [this.team.performer] : this.online;
  }

  /** One round of the task's own solution; the caller loops until the team moved on. */
  private solve(stop: Stop, option: ZoneName): void {
    const current = this.w.state.stops.find((s) => s.id === stop.id) ?? stop;
    const ctx = this.context(current, option);
    const who = this.players(current);
    const first = who[0];
    if (!first) throw new Error('nobody plays the task');
    const kind = current.type === 'route' ? 'quiz' : kindOf(current, option);
    switch (kind) {
      case 'archery': {
        archeryTargets(ctx).forEach((block) => {
          if (!this.team.task) return;
          const shooter = { x: block.x + (option === 'A' ? 10 : -10), y: block.y, z: block.z };
          this.w.send({
            type: 'taskEvent', player: first, event: { type: 'projectileHit', block, shooter },
          });
        });
        break;
      }
      case 'parkour': {
        const { gold } = parkourCourse(ctx);
        this.w.stand(who, { x: gold.x + 0.5, y: gold.y + 1, z: gold.z + 0.5 });
        this.w.report();
        break;
      }
      case 'haystack': {
        const [block] = ctx.hidden;
        if (!block) throw new Error('the haystack hides no wool');
        this.w.send({
          type: 'taskEvent',
          player: first,
          event: {
            type: 'blockBroken', block, id: BLOCK.yellowWool,
          },
        });
        break;
      }
      case 'hunt':
        this.w.send({
          type: 'targetDied', tag: huntTag(this.id, current.id, option), killer: first,
        });
        break;
      case 'gather': {
        const need = GATHER[current.terrain];
        const item = need.items[0] ?? ITEM.wheatSeeds;
        const holder = this.w.players.get(first);
        if (holder) holder.items[item] = (holder.items[item] ?? 0) + need.count;
        this.choose({ type: 'continue' }, first);
        break;
      }
      case 'quiz':
      case 'recall':
        this.answer(ctx, kind, first);
        break;
      default: {
        const never: never = kind;
        throw new Error(`the sim has no solver for ${String(never)}`);
      }
    }
  }

  /** Answers the form the player was shown (starting the quiz first when no form is open). */
  private answer(ctx: TaskContext, kind: 'quiz' | 'recall', player: PlayerId): void {
    let ask = this.w.shown.get(player) as Ask | undefined;
    if (ask?.kind !== 'askQuestion') {
      this.choose({ type: 'continue' }, player);
      ask = this.w.shown.get(player) as Ask | undefined;
    }
    if (ask?.kind !== 'askQuestion') throw new Error(`no ${kind} question was asked`);
    this.w.shown.delete(player);
    const values = kind === 'quiz'
      ? [questionAt(ctx.deck, ask.seq).accepted[0] ?? '']
      : ask.fields.map((f, i) => (
        f.type === 'dropdown' ? f.options.indexOf(ctx.pits[i] ?? '') : 0));
    this.w.send({
      type: 'submitAnswer',
      player,
      stopId: ask.stopId,
      option: ask.option,
      seq: ask.seq,
      values,
    });
  }
}
