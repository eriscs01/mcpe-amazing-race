// A time penalty (spec §8.8): race hours turned into ticks the team serves on its Pit Stop mat.
import { HOUR } from '../config.js';

import type { LogLine, Team } from '../types.js';

/** `team` owing `hours` more race hours (whole ticks), and the log line that says so. */
export function owe(
  team: Team,
  hours: number,
  reason: string,
): { team: Team; log: LogLine } {
  const owed = team.penaltyOwed + Math.round(hours * HOUR);
  return {
    team: { ...team, penaltyOwed: owed },
    log: {
      event: 'penaltyAdded',
      fields: {
        team: team.id, leg: team.leg, reason, hours, owed,
      },
    },
  };
}
