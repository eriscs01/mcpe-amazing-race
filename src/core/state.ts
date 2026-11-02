// The starting point of every race and the defaults older saves are filled in from.
import { SETUP } from './config.js';
import { SCHEMA_VERSION } from './types.js';

import type { State } from './types.js';

export function createState(seed: number): State {
  const { sliders, toggles } = SETUP;
  return {
    v: SCHEMA_VERSION,
    phase: 'setup',
    seed,
    settings: {
      days: sliders.days.default,
      minutesPerDay: sliders.minutesPerDay.default,
      teamSize: sliders.teamSize.default,
      hostRaces: toggles.hostRaces,
      daylightCycle: toggles.daylightCycle,
    },
    clock: 0,
    day: 0,
    dayStartClock: 0,
    pins: [],
    stops: [],
    teams: [],
    players: {},
    leg: { n: 0, phase: 'racing' },
  };
}
