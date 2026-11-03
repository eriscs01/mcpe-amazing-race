// Setup screen (spec §4): the form model, reading its values back, and saving settings, which
// only the host can do and only before a course is generated.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SETUP } from '../src/core/config.js';
import { reduce } from '../src/core/race/engine.js';
import {
  COPY_WORLD_REMINDER, settingsFromValues, setupFields,
} from '../src/core/setup.js';
import { createState } from '../src/core/state.js';

import type { Phase, Settings, State } from '../src/core/types.js';

const hosted = (): State => ({ ...createState(1), hostId: 'h', players: { h: { name: 'Hana' } } });
const chosen: Settings = {
  days: 2, minutesPerDay: 90, teamSize: 3, hostRaces: true, daylightCycle: false,
};
const save = (settings: Settings, by = 'h') => ({ type: 'saveSettings' as const, by, settings });

test('the setup form has the spec\'s five controls, filled from the current settings', () => {
  const fields = setupFields(chosen);
  assert.deepEqual(fields.map((f) => [f.key, f.kind, f.value]), [
    ['days', 'slider', 2],
    ['minutesPerDay', 'slider', 90],
    ['teamSize', 'slider', 3],
    ['hostRaces', 'toggle', true],
    ['daylightCycle', 'toggle', false],
  ]);
  const minutes = fields[1];
  assert.deepEqual(
    minutes?.kind === 'slider' ? [minutes.min, minutes.max, minutes.step] : [],
    [30, 120, 15],
  );
  for (const f of fields) assert.ok(f.label.length > 0);
});

test('the copy-world reminder is the spec\'s wording', () => {
  assert.equal(
    COPY_WORLD_REMINDER,
    'Play in a copy of your world. Use Copy World in world settings before generating. '
      + 'Arenas are not removed afterwards.',
  );
});

test('form values are read back in field order, skipping label entries', () => {
  assert.deepEqual(settingsFromValues([2, 90, 3, true, false]), chosen);
  assert.deepEqual(settingsFromValues([undefined, 2, 90, 3, true, false]), chosen);
});

test('form values of the wrong count or type are not read as settings', () => {
  assert.equal(settingsFromValues([2, 90, 3, true]), undefined);
  assert.equal(settingsFromValues([2, 90, 3, 'yes', false]), undefined);
  assert.equal(settingsFromValues([true, 90, 3, true, false]), undefined);
  assert.equal(settingsFromValues(undefined), undefined);
});

test('the host saves settings in setup; the reply shows the derived plan', () => {
  const out = reduce(hosted(), save(chosen));
  assert.equal(out.refusal, undefined);
  assert.deepEqual(out.state.settings, chosen);
  assert.deepEqual(out.effects, [{
    kind: 'notify',
    to: 'h',
    code: 'settingsSaved',
    text: 'Settings saved: 6 legs · ~1,800-block radius · eliminations set by teams',
  }]);
  assert.deepEqual(out.logs, [{
    event: 'settingsSaved',
    fields: {
      days: 2,
      minutesPerDay: 90,
      teamSize: 3,
      hostRaces: true,
      daylightCycle: false,
      legs: 6,
      by: 'h',
    },
  }]);
});

test('settings outside the spec ranges or off the slider step are refused', () => {
  const state = hosted();
  for (const bad of [
    { ...chosen, days: 0 },
    { ...chosen, days: 6 },
    { ...chosen, days: 2.5 },
    { ...chosen, minutesPerDay: 40 },
    { ...chosen, minutesPerDay: 135 },
    { ...chosen, teamSize: 1 },
    { ...chosen, teamSize: 5 },
  ]) {
    const out = reduce(state, save(bad));
    assert.equal(out.refusal, 'badSettings', JSON.stringify(bad));
    assert.equal(out.state, state);
  }
  assert.equal(SETUP.sliders.minutesPerDay.step, 15);
});

test('only the host saves settings, and only in setup', () => {
  assert.equal(reduce(hosted(), save(chosen, 'b')).refusal, 'notHost');
  const blocked: Phase[] = ['generating', 'ready', 'running', 'paused', 'dayEnded', 'finished'];
  for (const phase of blocked) {
    const out = reduce({ ...hosted(), phase }, save(chosen));
    assert.equal(out.refusal, 'badPhase', phase);
    assert.deepEqual(out.effects.map((e) => e.kind === 'notify' && e.code), ['badPhase']);
  }
});
