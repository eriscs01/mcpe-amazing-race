// The racer HUD (spec §9.1): what each racer's action bar says and where their particle trail
// goes. A pure query over the state and what the adapter reads from each online player; it
// changes nothing, so it is not an Action and keeps no state of its own.
import { clueBoxPos, targetStop } from './clue.js';
import { CLUE, HUD, TICKS_PER_SECOND } from './config.js';
import {
  horizontalDistance, offsetByYaw, relativeYaw, yawTowards,
} from './vec.js';

import type {
  PlayerId, State, Stop, Team,
} from './types.js';
import type { Vec3 } from './vec.js';

/** What the adapter reads from one online player. */
export interface HudView {
  id: PlayerId;
  /** Eye position: the trail starts here. */
  head: Vec3;
  /** Facing, in degrees (Bedrock: 0 = south). */
  yaw: number;
  overworld: boolean;
}

/** What to show one player: an action-bar text and, on trail frames, the particle positions. */
export interface HudFrame {
  to: PlayerId;
  text: string;
  trail?: Vec3[];
}

const CENTRE = (HUD.barCells - 1) / 2;

/**
 * The 21-cell bar for a target `rel` degrees from the heading (positive = right), `|` marking
 * the heading and `O` the target. Undefined when the target is behind the player.
 */
export function compassBar(rel: number): string | undefined {
  if (Math.abs(rel) > HUD.barSpan) return undefined;
  const target = CENTRE + Math.round((rel / HUD.barSpan) * CENTRE);
  const cells = Array.from({ length: HUD.barCells }, (_, i) => {
    if (i === target) return 'O';
    return i === CENTRE ? '|' : '-';
  });
  return `[${cells.join('')}]`;
}

const seconds = (ticks: number): number => Math.ceil(ticks / TICKS_PER_SECOND);

/** The line for a team held at a stop (spec §9.1); each part shows only while it applies. */
function taskLine(state: State, team: Team): string | undefined {
  const parts = [
    // Task progress joins here when the challenges arrive (G10-G12).
    team.penaltyOwed > 0 ? `Penalty owed: ${seconds(team.penaltyOwed)}s` : undefined,
    team.lockoutUntil !== undefined && team.lockoutUntil > state.clock
      ? `Locked out: ${seconds(team.lockoutUntil - state.clock)}s` : undefined,
    team.departAt !== undefined && team.departAt > state.clock
      ? `Departing in ${seconds(team.departAt - state.clock)}s` : undefined,
  ].filter((part) => part !== undefined);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

/** Whether a team's racers get a HUD now. G14's checked-in countdown extends this. */
const showsHud = (state: State, team: Team): boolean => state.phase === 'running'
  && team.status !== 'eliminated';

const ascii = (n: number): string => String(n);

function navigation(stop: Stop, view: HudView): { line: string; bearing?: number } {
  const { label } = CLUE[stop.type];
  if (stop.blind) {
    return { line: `${label}: X ${ascii(stop.pos.x)}, Z ${ascii(stop.pos.z)}` };
  }
  const box = clueBoxPos(stop);
  const metres = Math.round(horizontalDistance(view.head, box));
  // On top of the box there is no bearing: show it dead ahead.
  const bearing = horizontalDistance(view.head, box) < 1 ? view.yaw : yawTowards(view.head, box);
  const bar = compassBar(relativeYaw(view.yaw, bearing)) ?? '<< TURN AROUND >>';
  return { line: `${bar} ${metres}m ${label}`, bearing };
}

function frameFor(state: State, team: Team, view: HudView, trail: boolean): HudFrame | undefined {
  if (!view.overworld) return { to: view.id, text: 'Return to the Overworld' };
  const stop = targetStop(state, team);
  const nav = stop ? navigation(stop, view) : undefined;
  const lines = [nav?.line, taskLine(state, team)].filter((line) => line !== undefined);
  if (lines.length === 0) return undefined;
  const frame: HudFrame = { to: view.id, text: lines.join('\n') };
  if (!trail || nav?.bearing === undefined) return frame;
  const y = view.head.y - HUD.trailDrop;
  return {
    ...frame,
    trail: HUD.trailDistances.map((d) => ({ ...offsetByYaw(view.head, nav.bearing ?? 0, d), y })),
  };
}

/** The frames for the racers in `views`; players off a team, or with nothing to show, get none. */
export function hudFrames(
  state: State,
  views: readonly HudView[],
  opts: { trail: boolean },
): HudFrame[] {
  return views.flatMap((view) => {
    const team = state.teams.find((t) => t.id === state.players[view.id]?.teamId);
    if (!team || !showsHud(state, team)) return [];
    const frame = frameFor(state, team, view, opts.trail);
    return frame ? [frame] : [];
  });
}
