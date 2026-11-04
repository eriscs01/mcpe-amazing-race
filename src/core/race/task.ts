// Playing a task (spec §7, §8.2): starting it at a clue box, the racers' actions it counts, the
// shared zone it plays in and what completion does. What each kind builds and counts is in
// tasks/*; this file only knows "eligible players" and the kind. The Detour and Roadblock menus
// (option choice, performer pick, switching, quitting) are in taskFlow.ts.
import { advanceStep } from './advance.js';
import { zonesFor } from '../arena/layout.js';
import { targetStop } from '../clue.js';
import { BLOCK, TICKS_PER_SECOND } from '../config.js';
import { deckSeed } from '../quiz/bank.js';
import { Rng } from '../rng.js';
import { parseHuntTag } from '../tasks/hunt.js';
import { kindOf } from '../tasks/index.js';

import type { TaskKindName } from '../config.js';
import type { Held, TaskContext, TaskKind } from '../tasks/kind.js';
import type {
  Action, Effect, LogLine, PlayerId, Result, State, Stop, TaskEvent, Team, ZoneName,
} from '../types.js';

type Of<T extends Action['type']> = Extract<Action, { type: T }>;

/** One thing a stop offers: Detour option A or B (zone A or B), or a Roadblock's single task. */
export interface Offer {
  option: ZoneName;
  label: string;
  kind: TaskKind;
}

const titled = (word: string): string => `${word.charAt(0).toUpperCase()}${word.slice(1)}`;

export const offersOf = (stop: Stop): Offer[] => {
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

/** Whether a stop has a task that can be played now (its kind is in the registry). */
export const playable = (stop: Stop): boolean => offersOf(stop).length > 0;

export const teamOf = (state: State, id: PlayerId): Team | undefined => {
  const teamId = state.players[id]?.teamId;
  return state.teams.find((t) => t.id === teamId);
};

export const replaceTeam = (state: State, team: Team): State => ({
  ...state, teams: state.teams.map((t) => (t.id === team.id ? team : t)),
});
const replaceStop = (state: State, stop: Stop): State => ({
  ...state, stops: state.stops.map((s) => (s.id === stop.id ? stop : s)),
});
export const merge = (acc: Result, out: Result): Result => ({
  state: out.state,
  effects: [...acc.effects, ...out.effects],
  logs: [...(acc.logs ?? []), ...(out.logs ?? [])],
});

const contextOf = (
  state: State,
  stop: Stop,
  offer: Offer,
  team?: Team,
): TaskContext | undefined => {
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
    deck: deckSeed(state.seed, team?.id ?? '', stop.id, offer.option),
    pits: state.stops.filter((s) => s.type === 'pit' && s.leg < stop.leg)
      .sort((a, b) => a.leg - b.leg || a.id - b.id).map((s) => s.name),
    ...(team ? { team: { id: team.id, name: team.name, color: team.color } } : {}),
  };
};

/** For an offer just made from the stop itself, whose zone always exists. */
export const requireContext = (
  state: State,
  stop: Stop,
  offer: Offer,
  team?: Team,
): TaskContext => {
  const ctx = contextOf(state, stop, offer, team);
  if (!ctx) throw new Error(`stop ${stop.id} has no zone ${offer.option}`);
  return ctx;
};

/** The seeded draw for a zone's hidden wool: the same race gives the same pile. */
const rngFor = (state: State, stop: Stop, zone: ZoneName, refills: number): Rng => new Rng(
  (state.seed + stop.id * 7919 + (zone === 'A' ? 0 : 104729) + refills * 1299709) % 4294967296,
);

const keyOf = (stop: Stop, option: ZoneName): string => `${stop.id}:${option}`;

/** Who may count: any member on a Detour, only the performer on a Roadblock (spec §7.3). */
export const eligible = (team: Team, stop: Stop, player: PlayerId): boolean => (
  stop.type === 'roadblock' ? team.performer === player : team.members.includes(player));

export interface Playing {
  stop: Stop;
  offer: Offer;
  ctx: TaskContext;
  key: string;
}

/** The task a team is playing, if it is still at its stop and racing. */
export function playing(state: State, team: Team): Playing | undefined {
  const mine = team.task;
  const stop = mine ? state.stops.find((s) => s.id === mine.stopId) : undefined;
  if (!mine || !stop || team.status !== 'racing' || targetStop(state, team)?.id !== stop.id) {
    return undefined;
  }
  const offer = offersOf(stop).find((o) => o.option === mine.option);
  const ctx = offer ? contextOf(state, stop, offer, team) : undefined;
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
export function prepareZone(state: State, stop: Stop, offer: Offer): Result {
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
    // Hunt and Gather build nothing: there is no block to place.
    effects: build.ops.length > 0 ? [{
      kind: 'zoneBlocks', stop: stop.id, zone: offer.option, ops: build.ops,
    }] : [],
    logs: [{
      event: have ? 'zoneRefilled' : 'zoneBuilt',
      fields: {
        stop: stop.id, zone: offer.option, task: offer.kind.name, hidden: build.hidden?.length,
      },
    }],
  };
}

/**
 * Starts `offer` for `team` at `stop`: the zone, the gear, the team's progress. A Roadblock has
 * a `performer`, who alone gets the gear; on a Detour every member does. `by` is who chose it
 * (a question kind asks them its first question). With `held`, only gear the players lack is
 * given (a switch back to an option already played).
 */
export function beginTask(
  state: State,
  team: Team,
  stop: Stop,
  offer: Offer,
  by: PlayerId,
  performer?: PlayerId,
  held?: Held,
): Result {
  const zone = prepareZone(state, stop, offer);
  const current = zone.state.stops.find((s) => s.id === stop.id) ?? stop;
  const key = keyOf(stop, offer.option);
  const started: Team = {
    ...team,
    task: { stopId: stop.id, option: offer.option },
    ...(performer ? { performer } : {}),
    progress: { ...team.progress, [key]: team.progress[key] ?? offer.kind.initial },
  };
  const players = performer ? [performer] : team.members;
  const ctx = requireContext(zone.state, current, offer, team);
  const progress = started.progress[key] ?? offer.kind.initial;
  const effects: Effect[] = [
    ...zone.effects,
    ...offer.kind.equip(ctx, players, held),
    ...(offer.kind.enter?.(progress, ctx) ?? []),
    {
      kind: 'title',
      to: players,
      text: offer.kind.progressText(progress, ctx),
      chat: true,
    },
    ...(offer.kind.prompt?.(progress, ctx, performer ?? by) ?? []),
  ];
  const logs: LogLine[] = [...(zone.logs ?? []), {
    event: 'taskStarted',
    fields: {
      team: team.id, leg: team.leg, stop: stop.id, option: offer.option, task: offer.kind.name,
    },
  }];
  return { state: replaceTeam(zone.state, started), effects, logs };
}

const seconds = (ticks: number): number => Math.ceil(ticks / TICKS_PER_SECOND);
export const lockoutNotice = (to: PlayerId, ticks: number): Effect => ({
  kind: 'notify', to, code: 'lockedOut', text: `Locked out for ${seconds(ticks)}s.`,
});
/** Ticks of lockout the team still serves (the race clock stops while paused). */
export const lockedFor = (state: State, team: Team): number => Math.max(
  0,
  (team.lockoutUntil ?? 0) - state.clock,
);

/** Applies an event to the team's task: its progress, the kind's response, and completion. */
export function applyEvent(state: State, team: Team, now: Playing, event: TaskEvent): Result {
  const { kind } = now.offer;
  const before = team.progress[now.key] ?? kind.initial;
  const after = kind.onEvent(before, event, now.ctx);
  // The response comes first: a hand-in's items are taken before the next clue is sent.
  const response = kind.respond?.(event, before, now.ctx) ?? [];
  const fields = {
    team: team.id, leg: team.leg, stop: now.stop.id, task: kind.name,
  };
  // A form answers a question; unless it locked the team out, the next one (or the same one,
  // when the form was stale) is asked at once.
  const ticks = kind.lockoutTicks?.(before, after, now.ctx) ?? 0;
  const asking = event.type === 'answered' && ticks === 0 && !kind.done(after, now.ctx)
    ? kind.prompt?.(after, now.ctx, event.by) ?? [] : [];
  if (after === before) {
    return {
      state,
      effects: [...response, ...asking],
      ...(event.type === 'answered' ? { logs: [{ event: 'answerStale', fields }] } : {}),
    };
  }
  const progress = { ...team.progress, [now.key]: after };
  if (!kind.done(after, now.ctx)) {
    const text = kind.progressText(after, now.ctx);
    const locked = ticks > 0 && event.type === 'answered';
    return {
      state: replaceTeam(state, {
        ...team, progress, ...(locked ? { lockoutUntil: state.clock + ticks } : {}),
      }),
      effects: [...response, ...(locked ? [lockoutNotice(event.by, ticks)] : []), ...asking],
      logs: [
        { event: 'taskProgress', fields: { ...fields, text } },
        ...(locked ? [{
          event: 'lockout',
          fields: {
            ...fields, seconds: seconds(ticks), seq: event.seq, given: JSON.stringify(event.values),
          },
        }] : []),
      ],
    };
  }
  // The performer and any lockout end with the task (technical design §3).
  const {
    task, performer, lockoutUntil, ...rest
  } = team;
  const finished: Team = { ...rest, progress };
  const cleared = advanceStep(replaceTeam(state, finished), finished, now.stop.id);
  return {
    ...cleared,
    effects: [...response, ...cleared.effects],
    logs: [{ event: 'taskDone', fields: { ...fields, option: task?.option } },
      ...(cleared.logs ?? [])],
  };
}

/** Applies a racer's action to the team's task if they are eligible to count. */
function advanceTask(state: State, teamId: string, player: PlayerId, event: TaskEvent): Result {
  const team = state.teams.find((t) => t.id === teamId);
  const now = team ? playing(state, team) : undefined;
  if (!team || !now || !eligible(team, now.stop, player)) return { state, effects: [] };
  return applyEvent(state, team, now, event);
}

/**
 * An eligible racer used the box mid-task. A question task shows its current question, or the
 * lockout still to serve; any other kind answers the event.
 */
export function boxUsed(
  state: State,
  team: Team,
  now: Playing,
  player: PlayerId,
  held: Record<PlayerId, Record<string, number>>,
): Result {
  const { kind } = now.offer;
  if (!kind.prompt) return applyEvent(state, team, now, { type: 'boxUsed', by: player, held });
  const wait = lockedFor(state, team);
  const progress = team.progress[now.key] ?? kind.initial;
  return {
    state,
    effects: wait > 0 ? [lockoutNotice(player, wait)] : kind.prompt(progress, now.ctx, player),
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

/**
 * A Hunt husk died. A kill by an eligible racer of its team counts; a husk that died to anyone
 * else is respawned. A tag that is not the team's current Hunt (an earlier stop, a team that has
 * moved on) is ignored.
 */
export function targetDied(state: State, a: Of<'targetDied'>): Result {
  const tag = parseHuntTag(a.tag);
  const team = tag ? state.teams.find((t) => t.id === tag.team) : undefined;
  const now = team ? playing(state, team) : undefined;
  const current = tag && now?.stop.id === tag.stop && team?.task?.option === tag.zone
    && now.offer.kind.name === 'hunt';
  if (state.phase !== 'running' || !tag || !team || !now || !current) {
    return { state, effects: [] };
  }
  const credited = a.killer !== undefined && eligible(team, now.stop, a.killer);
  const out = applyEvent(state, team, now, { type: credited ? 'targetKilled' : 'targetLost' });
  if (credited) return out;
  const fields = {
    team: team.id, leg: team.leg, stop: now.stop.id, killer: a.killer,
  };
  return { ...out, logs: [...(out.logs ?? []), { event: 'targetLost', fields }] };
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

/** A question form came back (Quiz, Recall): checked against the team's current question. */
export function submitAnswer(state: State, a: Of<'submitAnswer'>): Result {
  const ignored = (reason: string): Result => ({
    state,
    effects: [],
    logs: [{ event: 'answerIgnored', fields: { player: a.player, stop: a.stopId, reason } }],
  });
  const team = teamOf(state, a.player);
  const now = team ? playing(state, team) : undefined;
  if (state.phase !== 'running') return ignored('notRunning');
  if (!team || !now || team.task?.stopId !== a.stopId || team.task.option !== a.option) {
    return ignored('noSuchTask');
  }
  if (!eligible(team, now.stop, a.player)) return ignored('notEligible');
  const wait = lockedFor(state, team);
  if (wait > 0) {
    return {
      state,
      effects: [lockoutNotice(a.player, wait)],
      logs: [{
        event: 'answerRefused', fields: { player: a.player, stop: a.stopId, reason: 'lockedOut' },
      }],
    };
  }
  return applyEvent(state, team, now, {
    type: 'answered', by: a.player, seq: a.seq, values: a.values,
  });
}
