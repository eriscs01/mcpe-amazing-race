// Arena state (spec §6.5-6.6): which stops have their arena, which are lit, and what the host
// is told. The arenas themselves are built by the adapter (arena/layout.ts has the geometry);
// this decides what each result changes and which effects follow.
import { notify, refuseUnlessHost } from './host.js';

import type {
  Action, ArenaFailure, ArenaSite, Effect, Phase, Result, State, Stop,
} from './types.js';

type Of<T extends Action['type']> = Extract<Action, { type: T }>;

/** Arenas are built while the course waits to start. */
export const BUILD_PHASES: readonly Phase[] = ['ready'];
/** A person lights stops only for checking; the race rules light them from the race start on. */
export const LIGHT_PHASES: readonly Phase[] = ['ready'];
/** Phases in which stops, and so their lights, exist. */
const STOP_PHASES: readonly Phase[] = ['ready', 'running', 'paused', 'dayEnded'];

const siteOf = (s: Stop): ArenaSite => ({ id: s.id, pos: s.pos, type: s.type });

export const unbuilt = (state: State): Stop[] => state.stops.filter((s) => !s.built);

export const allArenasBuilt = (state: State): boolean => (
  state.stops.length > 0 && unbuilt(state).length === 0);

/** The build request for every stop still missing its arena; none when all stand. */
export function buildEffects(state: State): Effect[] {
  const missing = unbuilt(state);
  if (missing.length === 0 || state.job === undefined) return [];
  return [{ kind: 'buildArenas', job: state.job, sites: missing.map(siteOf) }];
}

/** The light request for the built stops among `stops`, each with the lit state it should have. */
export function lightEffects(stops: readonly Stop[]): Effect[] {
  const sites = stops.filter((s) => s.built).map((s) => ({ ...siteOf(s), lit: s.lit }));
  return sites.length > 0 ? [{ kind: 'lightStops', sites }] : [];
}

/** What a reloaded world must redo: unfinished builds (before the race) and every light. */
export function resumeEffects(state: State): Effect[] {
  if (!STOP_PHASES.includes(state.phase)) return [];
  return [
    ...(state.phase === 'ready' ? buildEffects(state) : []),
    ...lightEffects(state.stops),
  ];
}

/** A result counts only for the course being built: the newest job, while it waits in ready. */
function current(state: State, job: number): Result | undefined {
  if (state.phase === 'ready' && state.job === job) return undefined;
  return { state, refusal: 'staleJob', effects: [] };
}

const hostNote = (state: State, code: string, text: string): Effect[] => (
  state.hostId ? [notify(state.hostId, code, text)] : []);

export function buildArenas(state: State, a: Of<'buildArenas'>): Result {
  const denied = refuseUnlessHost(state, a.by, BUILD_PHASES);
  if (denied) return denied;
  const missing = unbuilt(state).length;
  if (missing === 0) {
    return { state, effects: [notify(a.by, 'arenasBuilt', 'Every arena is already built.')] };
  }
  return {
    state,
    effects: [
      ...buildEffects(state),
      notify(a.by, 'arenasBuilding', `Building ${missing} arena${missing === 1 ? '' : 's'}.`),
    ],
    logs: [{ event: 'arenasRequested', fields: { missing, by: a.by } }],
  };
}

export function arenaBuilt(state: State, a: Of<'arenaBuilt'>): Result {
  const stale = current(state, a.job);
  if (stale) return stale;
  const found = state.stops.find((s) => s.id === a.stop);
  if (!found) return { state, refusal: 'unknownStop', effects: [] };
  // A probe over an old arena read its clue box as the ground; the arena's real floor wins.
  const updated: Stop = { ...found, built: true, pos: { ...found.pos, y: a.y } };
  const next = { ...state, stops: state.stops.map((s) => (s.id === a.stop ? updated : s)) };
  return {
    state: next,
    effects: [
      ...lightEffects([updated]),
      ...(allArenasBuilt(next) ? hostNote(next, 'arenasBuilt', 'All arenas are built.') : []),
    ],
    logs: [{
      event: 'arenaBuilt',
      fields: {
        job: a.job, stop: a.stop, y: a.y, was: found.pos.y, existing: a.existing,
      },
    }],
  };
}

const FAILURE_TEXT: Record<ArenaFailure, string> = {
  timeout: 'the area did not load in time',
  tickingAreaFull: 'the world has no free ticking area (remove one with /tickingarea remove)',
  error: 'it failed unexpectedly (see the Content Log)',
};

export function arenaBuildFailed(state: State, a: Of<'arenaBuildFailed'>): Result {
  const stale = current(state, a.job);
  if (stale) return stale;
  const found = state.stops.find((s) => s.id === a.stop);
  if (!found) return { state, refusal: 'unknownStop', effects: [] };
  return {
    state,
    effects: hostNote(
      state,
      'arenaBuildFailed',
      `Arena of stop ${a.stop} was not built: ${FAILURE_TEXT[a.reason]}. `
        + 'Use Build arenas to try again.',
    ),
    logs: [{ event: 'arenaBuildFailed', fields: { job: a.job, stop: a.stop, reason: a.reason } }],
  };
}

export function setLit(state: State, a: Of<'setLit'>): Result {
  if (a.by !== undefined) {
    const denied = refuseUnlessHost(state, a.by, LIGHT_PHASES);
    if (denied) return denied;
  }
  const ids = a.stops === 'all' ? state.stops.map((s) => s.id) : a.stops;
  if (ids.some((id) => !state.stops.some((s) => s.id === id))) {
    return { state, refusal: 'unknownStop', effects: [] };
  }
  const stops = state.stops.map((s) => (ids.includes(s.id) ? { ...s, lit: a.lit } : s));
  return {
    state: { ...state, stops },
    effects: lightEffects(stops.filter((s) => ids.includes(s.id))),
    logs: [{ event: 'stopsLit', fields: { stops: ids.join(','), lit: a.lit, by: a.by } }],
  };
}

/** `race:light <stop id|all> <on|off>`: the host's check of the lighting before the race. */
export function parseLightCommand(
  message: string,
): { stops: number[] | 'all'; lit: boolean } | undefined {
  const [which, mode, ...extra] = message.trim().split(/\s+/);
  if (extra.length > 0 || (mode !== 'on' && mode !== 'off')) return undefined;
  if (which === 'all') return { stops: 'all', lit: mode === 'on' };
  if (which === undefined || !/^\d+$/.test(which)) return undefined;
  return { stops: [Number(which)], lit: mode === 'on' };
}
