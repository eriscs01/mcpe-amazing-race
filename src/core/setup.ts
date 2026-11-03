// Setup screen (spec §4): the form's controls as a model the adapter renders, reading the
// submitted values back, and the host saving settings before a course is generated.
import { SETUP } from './config.js';
import { notify, refuse, refuseUnlessHost } from './host.js';
import { derivePlan, planSummary } from './plan.js';

import type {
  Action, Phase, Result, Settings, State,
} from './types.js';

/** Settings shape the course (legs, radius), so they change only before generating. */
export const SETTINGS_PHASES: readonly Phase[] = ['setup'];

/** Shown on the Setup and Generate course screens (spec §4). */
export const COPY_WORLD_REMINDER = 'Play in a copy of your world. Use Copy World in world '
  + 'settings before generating. Arenas are not removed afterwards.';

type SliderKey = keyof typeof SETUP.sliders;
type ToggleKey = keyof typeof SETUP.toggles;

export type SetupField = {
  kind: 'slider';
  key: SliderKey;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
} | { kind: 'toggle'; key: ToggleKey; label: string; value: boolean };

const SLIDER_LABELS: Record<SliderKey, string> = {
  days: 'Days',
  minutesPerDay: 'Minutes per day',
  teamSize: 'Players per team',
};
const TOGGLE_LABELS: Record<ToggleKey, string> = {
  hostRaces: 'Host also races',
  daylightCycle: 'Day-night cycle',
};
const SLIDERS = Object.keys(SLIDER_LABELS) as SliderKey[];
const TOGGLES = Object.keys(TOGGLE_LABELS) as ToggleKey[];

/** The form's controls in display order, filled from `settings`. */
export function setupFields(settings: Settings): SetupField[] {
  return [
    ...SLIDERS.map((key): SetupField => {
      const { min, max, step } = SETUP.sliders[key];
      return {
        kind: 'slider', key, label: SLIDER_LABELS[key], min, max, step, value: settings[key],
      };
    }),
    ...TOGGLES.map((key): SetupField => ({
      kind: 'toggle', key, label: TOGGLE_LABELS[key], value: settings[key],
    })),
  ];
}

/**
 * Reads submitted form values in field order. Text-only rows (the reminder label) may or may
 * not take a slot holding undefined, so those are skipped. Undefined if the shape is wrong.
 */
export function settingsFromValues(values: readonly unknown[] | undefined): Settings | undefined {
  const given = (values ?? []).filter((v) => v !== undefined);
  if (given.length !== SLIDERS.length + TOGGLES.length) return undefined;
  const numbers = given.slice(0, SLIDERS.length);
  const flags = given.slice(SLIDERS.length);
  if (!numbers.every((v) => typeof v === 'number')) return undefined;
  if (!flags.every((v) => typeof v === 'boolean')) return undefined;
  const [days, minutesPerDay, teamSize] = numbers as [number, number, number];
  const [hostRaces, daylightCycle] = flags as [boolean, boolean];
  return {
    days, minutesPerDay, teamSize, hostRaces, daylightCycle,
  };
}

function inRange(settings: Settings): boolean {
  return SLIDERS.every((key) => {
    const { min, max, step } = SETUP.sliders[key];
    const v = settings[key];
    return v >= min && v <= max && Number.isInteger((v - min) / step);
  });
}

export function saveSettings(state: State, a: Extract<Action, { type: 'saveSettings' }>): Result {
  const denied = refuseUnlessHost(state, a.by, SETTINGS_PHASES);
  if (denied) return denied;
  const { settings } = a;
  if (!inRange(settings)) {
    return refuse(state, a.by, 'badSettings', 'Those settings are outside the allowed ranges.');
  }
  const plan = derivePlan(settings, state.teams.length);
  return {
    state: { ...state, settings: { ...settings } },
    effects: [
      notify(a.by, 'settingsSaved', `Settings saved: ${planSummary(plan, state.teams.length)}`),
    ],
    logs: [{ event: 'settingsSaved', fields: { ...settings, legs: plan.legs, by: a.by } }],
  };
}
