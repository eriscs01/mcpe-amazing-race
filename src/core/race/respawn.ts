// A racer spawns (spec §12): back after a death, or joining again after being away. A death sends
// them to the team's last cleared stop; a rejoin gives back what the race gave (Passport, kit,
// name tag, movement lock, Spectator for an eliminated team) and puts them with their team.
import { lockedPlayers } from './locks.js';
import { teamOf } from './task.js';
import { matCentre } from '../clue.js';

import type {
  Action, Effect, Phase, PlayerId, Result, State, Team,
} from '../types.js';

const IN_RACE: readonly Phase[] = ['running', 'paused', 'dayEnded'];

const same = (state: State): Result => ({ state, effects: [] });

/** The player's own copy of the Race Control is the host's; only the Passport is taken. */
const leave = (id: PlayerId): Effect[] => [
  { kind: 'takeItem', from: id, item: 'passport' },
];

/** Where a team stands: the mat of the stop it last cleared. */
const matOf = (state: State, team: Team) => {
  const stop = state.stops.find((s) => s.id === team.lastClearedStop);
  return stop ? matCentre(stop) : undefined;
};

/** Whether the spawn must be held still: a countdown, the mat, or a paused race. */
const held = (state: State, id: PlayerId): boolean => state.phase === 'paused'
  || lockedPlayers(state).includes(id);

function died(state: State, team: Team, a: Extract<Action, { type: 'playerSpawned' }>): Result {
  if (state.phase !== 'running' && state.phase !== 'paused') return same(state);
  const pos = matOf(state, team);
  const stop = state.stops.find((s) => s.id === team.lastClearedStop);
  const mates = team.members.filter((id) => id !== a.player);
  return {
    state,
    effects: [
      ...(pos ? [{ kind: 'teleport' as const, players: [a.player], pos }] : []),
      // Input permissions after a respawn are not known to survive: say it again.
      ...(held(state, a.player)
        ? [{ kind: 'lockMovement' as const, players: [a.player], locked: true }] : []),
      ...(mates.length > 0 ? [{
        kind: 'title' as const,
        to: mates,
        text: `${a.name} died and went back to ${stop?.name ?? 'the last stop'}.`,
        chat: true,
      }] : []),
    ],
    logs: [{
      event: 'racerDied',
      fields: { player: a.player, team: team.id, stop: team.lastClearedStop },
    }],
  };
}

function rejoined(state: State, team: Team, a: Extract<Action, { type: 'playerSpawned' }>): Result {
  const record = state.players[a.player];
  const kit = record?.kitted !== true;
  const [mate] = a.mates ?? [];
  const pos = mate?.pos ?? matOf(state, team);
  const next: State = kit
    ? {
      ...state,
      players: { ...state.players, [a.player]: { name: a.name, ...record, kitted: true } },
    }
    : state;
  return {
    state: next,
    effects: [
      // The kit clears the pack, so the Passport the host rule gave comes again after it.
      ...(kit ? [
        {
          kind: 'kitRacer' as const, player: a.player, name: a.name, color: team.color,
        },
        { kind: 'giveItem' as const, to: a.player, item: 'passport' as const },
      ] : []),
      ...(pos && state.phase !== 'dayEnded'
        ? [{ kind: 'teleport' as const, players: [a.player], pos }] : []),
      ...(held(state, a.player)
        ? [{ kind: 'lockMovement' as const, players: [a.player], locked: true }] : []),
    ],
    logs: [{
      event: 'racerRejoined',
      fields: {
        player: a.player, team: team.id, kit, to: mate ? 'mate' : 'stop',
      },
    }],
  };
}

/**
 * What a spawn means for the race: a death, a rejoin during the race, or a rejoin after End race
 * (the player is released then). The Passport of a rejoiner is given by the host rules.
 */
export function respawned(state: State, a: Extract<Action, { type: 'playerSpawned' }>): Result {
  const team = teamOf(state, a.player);
  if (!team) return same(state);
  if (state.ended) {
    return a.initial ? {
      state,
      effects: [
        { kind: 'resetPlayers', players: [a.player] },
        { kind: 'lockMovement', players: [a.player], locked: false },
        ...leave(a.player),
      ],
      logs: [{ event: 'racerReleased', fields: { player: a.player } }],
    } : same(state);
  }
  if (!IN_RACE.includes(state.phase)) return same(state);
  if (team.status === 'eliminated') {
    return a.initial ? {
      state,
      effects: [{ kind: 'spectate', players: [a.player] }, ...leave(a.player)],
      logs: [{ event: 'racerSpectating', fields: { player: a.player, team: team.id } }],
    } : same(state);
  }
  return a.initial ? rejoined(state, team, a) : died(state, team, a);
}
