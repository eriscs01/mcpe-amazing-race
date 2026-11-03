// Playing a task (spec §7, §8.2): starting it at a clue box, the racers' actions it counts, the
// shared zone it plays in and what completion does. What each kind builds and counts is in
// tasks/*; this file only knows "eligible players" and the kind. The Detour and Roadblock forms
// (option choice, performer pick, switching, quitting) arrive with G14; until then a Detour
// starts its first playable option and a Roadblock's performer is whoever used the box.
import { advanceStep } from './advance.js';
import { zonesFor } from '../arena/layout.js';
import { targetStop } from '../clue.js';
import { BLOCK } from '../config.js';
import { Rng } from '../rng.js';
import { kindOf } from '../tasks/index.js';

import type { TaskKindName } from '../config.js';
import type { TaskContext, TaskKind } from '../tasks/kind.js';
import type {
  Action, Effect, LogLine, PlayerId, Result, State, Stop, TaskEvent, Team, ZoneName,
} from '../types.js';

type Of<T extends Action['type']> = Extract<Action, { type: T }>;

/** One thing a stop offers: Detour option A or B (zone A or B), or a Roadblock's single task. */
interface Offer {
  option: ZoneName;
  label: string;
  kind: TaskKind;
}

const titled = (word: string): string => `${word.charAt(0).toUpperCase()}${word.slice(1)}`;

const offersOf = (stop: Stop): Offer[] => {
  const { task } = stop;
  const make = (option: ZoneName, label: string, name: TaskKindName): Offer[] => {
    const kind = kindOf(name);
    return kind ? [{ option, label, kind }] : [];
  };
  if (task?.type === 'detour') {
    const [a, b] = task.options;
    return [...make('A', a.name, a.kind), ...make('B', b.name, b.kind)];
  }
  return task?.type === 'roadblock' ? make('A', titled(task.kind), task.kind) : [];
};

/** Whether a stop has a task that can be played now (Hunt, Gather, Quiz and Recall come later). */
export const playable = (stop: Stop): boolean => offersOf(stop).length > 0;

const teamOf = (state: State, id: PlayerId): Team | undefined => {
  const teamId = state.players[id]?.teamId;
  return state.teams.find((t) => t.id === teamId);
};

const replaceTeam = (state: State, team: Team): State => ({
  ...state, teams: state.teams.map((t) => (t.id === team.id ? team : t)),
});
const replaceStop = (state: State, stop: Stop): State => ({
  ...state, stops: state.stops.map((s) => (s.id === stop.id ? stop : s)),
});
const merge = (acc: Result, out: Result): Result => ({
  state: out.state,
  effects: [...acc.effects, ...out.effects],
  logs: [...(acc.logs ?? []), ...(out.logs ?? [])],
});

const contextOf = (state: State, stop: Stop, offer: Offer): TaskContext | undefined => {
  const zone = zonesFor(stop.type, stop.pos).find((z) => z.zone === offer.option);
  if (!zone) return undefined;
  return {
    stop,
    zone: offer.option,
    centre: zone.centre,
    leg: stop.leg,
    teams: state.teams.length,
    hidden: stop.zones?.[offer.option]?.hidden ?? [],
    label: offer.label,
  };
};

/** For an offer just made from the stop itself, whose zone always exists. */
const requireContext = (state: State, stop: Stop, offer: Offer): TaskContext => {
  const ctx = contextOf(state, stop, offer);
  if (!ctx) throw new Error(`stop ${stop.id} has no zone ${offer.option}`);
  return ctx;
};

/** The seeded draw for a zone's hidden wool: the same race gives the same pile. */
const rngFor = (state: State, stop: Stop, zone: ZoneName, refills: number): Rng => new Rng(
  (state.seed + stop.id * 7919 + (zone === 'A' ? 0 : 104729) + refills * 1299709) % 4294967296,
);

const keyOf = (stop: Stop, option: ZoneName): string => `${stop.id}:${option}`;

/** Who may count: any member on a Detour, only the performer on a Roadblock (spec §7.3). */
const eligible = (team: Team, stop: Stop, player: PlayerId): boolean => (
  stop.type === 'roadblock' ? team.performer === player : team.members.includes(player));

interface Playing {
  stop: Stop;
  offer: Offer;
  ctx: TaskContext;
  key: string;
}

/** The task a team is playing, if it is still at its stop and racing. */
function playing(state: State, team: Team): Playing | undefined {
  const mine = team.task;
  const stop = mine ? state.stops.find((s) => s.id === mine.stopId) : undefined;
  if (!mine || !stop || team.status !== 'racing' || targetStop(state, team)?.id !== stop.id) {
    return undefined;
  }
  const offer = offersOf(stop).find((o) => o.option === mine.option);
  const ctx = offer ? contextOf(state, stop, offer) : undefined;
  // A task whose option or zone no longer exists is treated as none (never thrown into a tick).
  return offer && ctx ? {
    stop, offer, ctx, key: keyOf(stop, mine.option),
  } : undefined;
}

/** "Aim: targets 3/5" for the team's task, or undefined when it has none (the HUD's line). */
export function taskProgressText(state: State, team: Team): string | undefined {
  const now = playing(state, team);
  const progress = now ? team.progress[now.key] ?? now.offer.kind.initial : undefined;
  return now && progress ? now.offer.kind.progressText(progress, now.ctx) : undefined;
}

/** Builds the zone if it has not been (or its haystack ran out); one build for every team. */
function prepareZone(state: State, stop: Stop, offer: Offer): Result {
  const have = stop.zones?.[offer.option];
  const emptied = offer.kind.name === 'haystack' && (have?.hidden?.length ?? 0) === 0;
  if (have && !emptied) return { state, effects: [] };
  const refills = have ? (have.refills ?? 0) + 1 : 0;
  const build = offer.kind.build(
    requireContext(state, stop, offer),
    rngFor(state, stop, offer.option, refills),
  );
  const zone = {
    kind: offer.kind.name,
    ...(build.hidden ? { hidden: build.hidden, refills } : {}),
  };
  const built: Stop = { ...stop, zones: { ...stop.zones, [offer.option]: zone } };
  return {
    state: replaceStop(state, built),
    effects: [{
      kind: 'zoneBlocks', stop: stop.id, zone: offer.option, ops: build.ops,
    }],
    logs: [{
      event: have ? 'zoneRefilled' : 'zoneBuilt',
      fields: {
        stop: stop.id, zone: offer.option, task: offer.kind.name, hidden: build.hidden?.length,
      },
    }],
  };
}

/** Starts a task for `team` at `stop`: the zone, the gear, the team's progress. */
function beginTask(state: State, team: Team, stop: Stop, performer: PlayerId): Result {
  const [offer] = offersOf(stop);
  if (!offer) return { state, effects: [] };
  const zone = prepareZone(state, stop, offer);
  const current = zone.state.stops.find((s) => s.id === stop.id) ?? stop;
  const key = keyOf(stop, offer.option);
  const roadblock = stop.type === 'roadblock';
  const started: Team = {
    ...team,
    task: { stopId: stop.id, option: offer.option },
    ...(roadblock ? { performer } : {}),
    progress: { ...team.progress, [key]: team.progress[key] ?? offer.kind.initial },
  };
  const players = roadblock ? [performer] : team.members;
  const effects: Effect[] = [
    ...zone.effects,
    ...offer.kind.equip(requireContext(zone.state, current, offer), players),
    {
      kind: 'title',
      to: players,
      text: offer.kind.progressText(
        started.progress[key] ?? offer.kind.initial,
        requireContext(zone.state, current, offer),
      ),
      chat: true,
    },
  ];
  const logs: LogLine[] = [...(zone.logs ?? []), {
    event: 'taskStarted',
    fields: {
      team: team.id, leg: team.leg, stop: stop.id, option: offer.option, task: offer.kind.name,
    },
  }];
  return { state: replaceTeam(zone.state, started), effects, logs };
}

/**
 * A racer used the clue box of a Detour or Roadblock whose task is playable and the team is
 * together: start the task, or show its progress when it is already under way.
 */
export function useTaskBox(state: State, team: Team, stop: Stop, player: PlayerId): Result {
  if (team.task?.stopId === stop.id) {
    // A zone whose build failed was forgotten (`zoneBuildFailed`); using the box again retries.
    const offer = offersOf(stop).find((o) => o.option === team.task?.option);
    const zone = offer ? prepareZone(state, stop, offer) : { state, effects: [] };
    const text = taskProgressText(zone.state, team) ?? 'Task in progress.';
    return {
      ...zone,
      effects: [...zone.effects, {
        kind: 'notify', to: player, code: 'taskProgress', text,
      }],
    };
  }
  return beginTask(state, team, stop, player);
}

/** Applies a racer's action to the team's task; finishing it clears the stop. */
function advanceTask(state: State, teamId: string, player: PlayerId, event: TaskEvent): Result {
  const team = state.teams.find((t) => t.id === teamId);
  const now = team ? playing(state, team) : undefined;
  if (!team || !now || !eligible(team, now.stop, player)) return { state, effects: [] };
  const { kind } = now.offer;
  const before = team.progress[now.key] ?? kind.initial;
  const after = kind.onEvent(before, event, now.ctx);
  if (after === before) return { state, effects: [] };
  const progress = { ...team.progress, [now.key]: after };
  const fields = {
    team: team.id, leg: team.leg, stop: now.stop.id, task: kind.name,
  };
  if (!kind.done(after, now.ctx)) {
    const text = kind.progressText(after, now.ctx);
    return {
      state: replaceTeam(state, { ...team, progress }),
      effects: [],
      logs: [{ event: 'taskProgress', fields: { ...fields, text } }],
    };
  }
  const { task, ...rest } = team;
  const finished: Team = { ...rest, progress };
  const cleared = advanceStep(replaceTeam(state, finished), finished, now.stop.id);
  return {
    ...cleared,
    logs: [{ event: 'taskDone', fields: { ...fields, option: task?.option } },
      ...(cleared.logs ?? [])],
  };
}

/** A hidden wool was broken by anyone: it is no longer hidden; rebuild if a team still digs. */
function woolBroken(state: State, event: TaskEvent): Result {
  if (event.type !== 'blockBroken' || event.id !== BLOCK.yellowWool) {
    return { state, effects: [] };
  }
  const same = (p: { x: number; y: number; z: number }): boolean => p.x === event.block.x
    && p.y === event.block.y && p.z === event.block.z;
  const found = state.stops.flatMap((stop) => (['A', 'B'] as const).flatMap((zone) => (
    stop.zones?.[zone]?.hidden?.some(same) ? [{ stop, zone }] : [])))[0];
  if (!found) return { state, effects: [] };
  const { stop, zone } = found;
  const have = stop.zones?.[zone];
  const hidden = (have?.hidden ?? []).filter((p) => !same(p));
  const removed = replaceStop(state, {
    ...stop, zones: { ...stop.zones, [zone]: { ...have, kind: 'haystack', hidden } },
  });
  const stillDigging = removed.teams.some((t) => t.status === 'racing'
    && t.task?.stopId === stop.id && t.task.option === zone);
  const current = removed.stops.find((s) => s.id === stop.id);
  const offer = current ? offersOf(current).find((o) => o.option === zone) : undefined;
  if (hidden.length > 0 || !stillDigging || !current || !offer) {
    return { state: removed, effects: [] };
  }
  return prepareZone(removed, current, offer);
}

/** A racer's action: counts for their team's task, and any hidden wool it broke is tracked. */
export function taskEvent(state: State, a: Of<'taskEvent'>): Result {
  if (state.phase !== 'running') return { state, effects: [] };
  const team = teamOf(state, a.player);
  const counted = team ? advanceTask(state, team.id, a.player, a.event) : { state, effects: [] };
  return merge(counted, woolBroken(counted.state, a.event));
}

/** Where racers stand (every 10 ticks): the tasks that finish by standing somewhere. */
export function taskStanding(state: State, a: Of<'racerPositions'>): Result {
  if (state.phase !== 'running') return { state, effects: [] };
  return a.players.reduce<Result>((acc, player) => {
    const team = player.pos ? teamOf(acc.state, player.id) : undefined;
    if (!team || !player.pos) return acc;
    const event: TaskEvent = { type: 'standing', pos: player.pos };
    return merge(acc, advanceTask(acc.state, team.id, player.id, event));
  }, { state, effects: [] });
}

/** The adapter could not build a zone: forget it, and tell the teams waiting on it to retry. */
export function zoneBuildFailed(state: State, a: Of<'zoneBuildFailed'>): Result {
  const stop = state.stops.find((s) => s.id === a.stop);
  if (!stop?.zones?.[a.zone]) return { state, effects: [] };
  const { [a.zone]: lost, ...zones } = stop.zones;
  const waiting = state.teams.filter((t) => t.task?.stopId === stop.id
    && t.task.option === a.zone).flatMap((t) => t.members);
  return {
    state: replaceStop(state, { ...stop, zones }),
    effects: waiting.map((to) => ({
      kind: 'notify' as const,
      to,
      code: 'zoneBuildFailed',
      text: 'The task area did not build. Use the clue box again to retry.',
    })),
    logs: [{ event: 'zoneForgotten', fields: { stop: stop.id, zone: a.zone, task: lost?.kind } }],
  };
}
