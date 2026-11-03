// Derived plan (spec §4) and elimination schedule (spec §8.6). Before the race it is derived on
// demand from the settings and current teams; race start stores it, when the teams are final.
import { PLAN } from './config.js';

import type { Plan, Settings, State } from './types.js';

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

/** E = max(0, N − 3) capped at L − 1, placed on the last E legs before the final. */
export function eliminationLegs(teams: number, legs: number): number[] {
  const count = Math.min(Math.max(0, teams - PLAN.finalists), legs - 1);
  return Array.from({ length: count }, (_, i) => legs - count + i);
}

export function derivePlan(settings: Settings, teams: number): Plan {
  const legsPerDay = Math.max(1, Math.floor(settings.minutesPerDay / PLAN.legMinutes));
  const legs = clamp(settings.days * legsPerDay, PLAN.legs.min, PLAN.legs.max);
  const { radius: r } = PLAN;
  const radius = clamp(r.base + r.perLeg * legs, r.min, r.max);
  return {
    legs, legsPerDay, radius, eliminationLegs: eliminationLegs(teams, legs),
  };
}

export function planOf(state: State): Plan {
  return derivePlan(state.settings, state.teams.length);
}

export function boundary(radius: number): { warn: number; hard: number } {
  return { warn: radius + PLAN.boundary.warn, hard: radius + PLAN.boundary.hard };
}

/** "1800" → "1,800"; done by hand because the game's JavaScript has no locale data. */
function grouped(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+$)/g, ',');
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "6 legs · 3 eliminations · ~1,800-block radius" (spec §4). */
export function planSummary(plan: Plan, teams: number): string {
  const radius = `~${grouped(plan.radius)}-block radius`;
  const legs = plural(plan.legs, 'leg');
  if (teams === 0) return `${legs} · ${radius} · eliminations set by teams`;
  return `${legs} · ${plural(plan.eliminationLegs.length, 'elimination')} · ${radius}`;
}
