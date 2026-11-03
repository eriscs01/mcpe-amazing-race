// Clearing a stop: the team's step moves on and it is told its next clue. Shared by Route Info
// (clue box) and every task that finishes at a clue box.
import {
  clueText, legStops, sidebarRows,
} from '../clue.js';

import type {
  Effect, Result, State, Team,
} from '../types.js';

export function advanceStep(state: State, team: Team, stopId: number): Result {
  const stepped: Team = { ...team, step: team.step + 1, lastClearedStop: stopId };
  const next = { ...state, teams: state.teams.map((t) => (t.id === team.id ? stepped : t)) };
  const following = legStops(next, team.leg)[stepped.step];
  const effects: Effect[] = [
    ...(following ? [{
      kind: 'title' as const, to: team.members, text: clueText(next, following), chat: true,
    }] : []),
    { kind: 'sidebar', rows: sidebarRows(next) },
  ];
  return {
    state: next,
    effects,
    logs: [{
      event: 'clueCleared',
      fields: {
        team: team.id, leg: team.leg, step: team.step, stop: stopId,
      },
    }],
  };
}
