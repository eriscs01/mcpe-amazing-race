import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SETUP } from '../src/core/config.js';
import { createState } from '../src/core/state.js';
import { SCHEMA_VERSION } from '../src/core/types.js';

test('a new race starts in setup with the default settings and the given seed', () => {
  const s = createState(1234);
  assert.equal(s.v, SCHEMA_VERSION);
  assert.equal(s.phase, 'setup');
  assert.equal(s.seed, 1234);
  assert.equal(s.clock, 0);
  assert.deepEqual(s.settings, {
    days: SETUP.sliders.days.default,
    minutesPerDay: SETUP.sliders.minutesPerDay.default,
    teamSize: SETUP.sliders.teamSize.default,
    hostRaces: SETUP.toggles.hostRaces,
    daylightCycle: SETUP.toggles.daylightCycle,
  });
  assert.deepEqual([s.stops, s.teams, s.pins, s.players], [[], [], [], {}]);
});

test('new states share nothing mutable', () => {
  const a = createState(1);
  a.teams.push({} as never);
  a.settings.days = 5;
  const b = createState(1);
  assert.deepEqual([b.teams, b.settings.days], [[], SETUP.sliders.days.default]);
});
