// Shared by the Detour and Roadblock flow tests: a course with an Aim/Climb Detour at stop 2, an
// archery Roadblock at 3, and a quiz Roadblock at 7, and the menu round trip of a clue box.
import { boxOf, racing, stopOf } from './race.js';
import { DETOUR_PAIRS } from '../../src/core/config.js';
import { reduce } from '../../src/core/race/engine.js';
import { archeryTargets } from '../../src/core/tasks/archery.js';

import type { DetourOption } from '../../src/core/config.js';
import type {
  Effect, Result, State, Stop, TaskChoice, Team,
} from '../../src/core/types.js';

export { boxOf };

type Menu = Extract<Effect, { kind: 'taskMenu' }>['menu'];

const [aimClimb] = DETOUR_PAIRS;
if (!aimClimb) throw new Error('no detour pair');
const options: [DetourOption, DetourOption] = [aimClimb.a, aimClimb.b];

/** The course; `tasks` replaces the task of the stops it names. */
export function course(tasks: Record<number, Stop['task']> = {}): State {
  const base = new Map<number, Stop['task']>([
    [2, { type: 'detour', options }],
    [3, { type: 'roadblock', kind: 'archery' }],
    [7, { type: 'roadblock', kind: 'quiz' }],
  ]);
  Object.entries(tasks).forEach(([id, task]) => base.set(Number(id), task));
  const state = racing();
  return { ...state, stops: state.stops.map((s) => ({ ...s, task: base.get(s.id) })) };
}

/** The course with `teams` at `step` of leg 1 (1 is the Detour, 2 the Roadblock). */
export const at = (
  step: number,
  tasks?: Record<number, Stop['task']>,
  teams = ['red', 'blue'],
): State => {
  const state = course(tasks);
  return {
    ...state, teams: state.teams.map((t) => (teams.includes(t.id) ? { ...t, step } : t)),
  };
};

export const red = (state: State): Team => {
  const found = state.teams.find((t) => t.id === 'red');
  if (!found) throw new Error('no red team');
  return found;
};

export const click = (
  state: State,
  player: string,
  stopId: number,
  members = ['h', 'b'],
  items: Record<string, Record<string, number>> = {},
): Result => {
  const box = boxOf(state, stopId);
  return reduce(state, {
    type: 'interactClue',
    player,
    pos: box,
    members: members.map((id) => ({ id, pos: box, items: items[id] ?? {} })),
  });
};

/**
 * A menu button chosen. `items` is what each member carries now; `online` who is in the world
 * (and at the box).
 */
export const choose = (
  state: State,
  player: string,
  stopId: number,
  choice: TaskChoice,
  items: Record<string, Record<string, number>> = {},
  online = ['h', 'b'],
): Result => {
  const box = boxOf(state, stopId);
  return reduce(state, {
    type: 'taskChoice',
    player,
    stopId,
    choice,
    members: online.map((id) => ({ id, pos: box, items: items[id] ?? {} })),
  });
};

/** The menu a result shows to `to`; fails the test when there is none. */
export function menuTo(out: Result, to: string): Menu {
  const found = out.effects.find((e) => e.kind === 'taskMenu' && e.to === to);
  if (found?.kind !== 'taskMenu') throw new Error(`no menu for ${to}`);
  return found.menu;
}

export const labels = (menu: Menu): string[] => menu.buttons.map((b) => b.label);

/** The text of every notify and title effect. */
export const notes = (out: Result): string[] => out.effects.flatMap((e) => (
  e.kind === 'notify' || e.kind === 'title' ? [e.text] : []));

export const tick = (state: State): Result => reduce(state, { type: 'tick' });

/**
 * A box use followed through its menu the way a player usually does: the box action (hand in,
 * answer), else the first option, else themselves as the performer. A use that shows no menu
 * (refused, or told who is performing) is returned as it is.
 */
export function play(
  state: State,
  player: string,
  stopId: number,
  members = ['h', 'b'],
  items: Record<string, Record<string, number>> = {},
): Result {
  const opened = click(state, player, stopId, members, items);
  const shown = opened.effects.find((e) => e.kind === 'taskMenu' && e.to === player);
  if (shown?.kind !== 'taskMenu') return opened;
  const { buttons } = shown.menu;
  const pick = buttons.find((b) => b.command.type === 'continue')
    ?? buttons.find((b) => b.command.type === 'option')
    ?? buttons.find((b) => b.command.type === 'perform' && b.command.who === player);
  return pick ? choose(opened.state, player, stopId, pick.command, items, members) : opened;
}

/** A far, valid arrow into target `slot` of the archery zone A at `stopId`. */
export function shoot(state: State, stopId: number, slot: number, player = 'h'): State {
  const stop = stopOf(state, stopId);
  const [target] = archeryTargets({
    stop,
    zone: 'A',
    centre: stop.pos,
    leg: 1,
    teams: 2,
    hidden: [],
    label: 'Aim',
    deck: 0,
    pits: [],
  }).slice(slot);
  if (!target) throw new Error(`no target ${slot}`);
  const shooter = { x: target.x + 12, y: target.y, z: target.z };
  return reduce(state, {
    type: 'taskEvent', player, event: { type: 'projectileHit', block: target, shooter },
  }).state;
}
