// Arena geometry (spec §6.5, §6.6): what a stop's arena is made of, as operations on blocks.
// Pure: the adapter supplies a BlockWorld and runs the operations as a job; nothing here knows
// about the Script API.
import { ARENA, BLOCK } from '../config.js';

import type { BlockId } from '../config.js';
import type { Op, StopType, ZoneName } from '../types.js';
import type { Vec3 } from '../vec.js';

/** Where an arena stands: `pos.y` is the ground height g, the floor level. */
export interface Site {
  pos: Vec3;
  type: StopType;
}

export type { Op };

/** What the builder needs from the world; unloaded chunks make a call throw or read undefined. */
export interface BlockWorld {
  readonly minY: number;
  /** Highest placeable block height (inclusive). */
  readonly maxY: number;
  idAt: (x: number, y: number, z: number) => string | undefined;
  set: (pos: Vec3, block: BlockId) => void;
  fill: (from: Vec3, to: Vec3, block: BlockId, only?: readonly BlockId[]) => void;
  topY: (x: number, z: number) => number;
}

const { half } = ARENA;
const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const fill = (from: Vec3, to: Vec3, block: BlockId, only?: readonly BlockId[]): Op => (
  only ? {
    kind: 'fill', from, to, block, only,
  } : {
    kind: 'fill', from, to, block,
  });
const set = (pos: Vec3, block: BlockId): Op => ({ kind: 'set', pos, block });

/** Ground squares of the arena, for rules that act on its footprint (spec §7.4). */
export function footprint(pos: Vec3): { min: Vec3; max: Vec3 } {
  return { min: v(pos.x - half, pos.y, pos.z - half), max: v(pos.x + half, pos.y, pos.z + half) };
}

/** Below the floor, only these are replaced by dirt; solid ground stays. */
const SOFT_GROUND: readonly BlockId[] = [BLOCK.air, BLOCK.water, BLOCK.flowingWater];

function flags(pos: Vec3): Op[] {
  const { x, y: g, z } = pos;
  return [-half, half].flatMap((dx) => [-half, half].flatMap((dz) => [
    fill(v(x + dx, g + 1, z + dz), v(x + dx, g + ARENA.flagFence, z + dz), BLOCK.oakFence),
    set(v(x + dx, g + ARENA.flagFence + 1, z + dz), BLOCK.redWool),
    set(v(x + dx, g + ARENA.flagFence + 2, z + dz), BLOCK.yellowWool),
    set(v(x + dx, g + ARENA.flagFence + 3, z + dz), BLOCK.lantern),
  ]));
}

/** Torches at the spacing along each side of the floor edge, centred; the corners hold flags. */
function torches(pos: Vec3): Op[] {
  const { x, y: g, z } = pos;
  const steps = Math.floor((half - 1) / ARENA.torchSpacing);
  const offsets = Array.from({ length: 2 * steps + 1 }, (_, i) => (i - steps) * ARENA.torchSpacing);
  return offsets.flatMap((o) => [
    set(v(x + o, g + 1, z - half), BLOCK.torch),
    set(v(x + o, g + 1, z + half), BLOCK.torch),
    set(v(x - half, g + 1, z + o), BLOCK.torch),
    set(v(x + half, g + 1, z + o), BLOCK.torch),
  ]);
}

/** A 3 by 3 checker of red and yellow concrete, red at the corners. */
function mat(pos: Vec3): Op[] {
  const cz = pos.z + ARENA.matOffset;
  return [-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dz) => set(
    v(pos.x + dx, pos.y, cz + dz),
    (dx + dz) % 2 === 0 ? BLOCK.redConcrete : BLOCK.yellowConcrete,
  )));
}

/** What a reused arena may lack: the mat, if a re-run turned its place into Pit Stop or Finish. */
export function reuseOps({ pos, type }: Site): Op[] {
  return type === 'pit' || type === 'finish' ? mat(pos) : [];
}

/**
 * Everything that makes the arena, unlit, in spec order. The clue box goes last: it, with the
 * iron under it, is what marks an arena as finished, so a build cut short is never mistaken
 * for one (see `looksBuilt`).
 */
export function buildOps({ pos, type }: Site): Op[] {
  const { x, y: g, z } = pos;
  const edge = (y1: number, y2: number): [Vec3, Vec3] => [
    v(x - half, y1, z - half), v(x + half, y2, z + half)];
  return [
    fill(...edge(g + 1, g + ARENA.clearHeight), BLOCK.air),
    fill(...edge(g - ARENA.dirtDepth, g - 1), BLOCK.dirt, SOFT_GROUND),
    fill(...edge(g, g), BLOCK.smoothStone),
    {
      kind: 'clearColumn', x, z, fromY: g + ARENA.clearHeight + 1,
    },
    ...flags(pos),
    ...torches(pos),
    ...reuseOps({ pos, type }),
    fill(v(x - 1, g, z - 1), v(x + 1, g, z + 1), BLOCK.ironBlock),
    set(v(x, g + 1, z), BLOCK.yellowConcrete),
  ];
}

/** The clue box and beam glass for a lit or unlit stop (spec §6.6). */
export function lightOps({ pos, type }: Site, lit: boolean): Op[] {
  return [
    set(v(pos.x, pos.y + 1, pos.z), lit ? BLOCK.beacon : BLOCK.yellowConcrete),
    set(v(pos.x, pos.y + 2, pos.z), lit ? ARENA.glass[type] : BLOCK.air),
  ];
}

/** Runs operations against a world, yielding after each so a job never holds a tick. */
export function* applyOps(world: BlockWorld, ops: readonly Op[]): Generator<void> {
  const inside = (y: number): boolean => y >= world.minY && y <= world.maxY;
  const clamp = (y: number): number => Math.min(world.maxY, Math.max(world.minY, y));
  for (const op of ops) {
    switch (op.kind) {
      case 'set':
        if (inside(op.pos.y)) world.set(op.pos, op.block);
        break;
      case 'fill': {
        const from = v(op.from.x, clamp(op.from.y), op.from.z);
        const to = v(op.to.x, clamp(op.to.y), op.to.z);
        const overlaps = op.to.y >= world.minY && op.from.y <= world.maxY;
        if (overlaps) world.fill(from, to, op.block, op.only);
        break;
      }
      case 'clearColumn': {
        const top = Math.min(world.topY(op.x, op.z), world.maxY);
        if (top >= op.fromY) world.fill(v(op.x, op.fromY, op.z), v(op.x, top, op.z), BLOCK.air);
        break;
      }
      default: {
        const unknown: never = op;
        throw new Error(`unknown arena op ${JSON.stringify(unknown)}`);
      }
    }
    yield;
  }
}

export type { ZoneName };

/** Task zones (spec §6.5): A is the west half, B the east; Roadblock uses A only. */
export function zonesFor(type: StopType, pos: Vec3): { zone: ZoneName; centre: Vec3 }[] {
  const zoneA = { zone: 'A' as const, centre: v(pos.x - ARENA.zoneOffset, pos.y, pos.z) };
  const zoneB = { zone: 'B' as const, centre: v(pos.x + ARENA.zoneOffset, pos.y, pos.z) };
  if (type === 'detour') return [zoneA, zoneB];
  if (type === 'roadblock') return [zoneA];
  return [];
}

const CLUE_BOXES: readonly string[] = [BLOCK.beacon, BLOCK.yellowConcrete];

/**
 * Whether an arena already stands at `pos` (#32): iron under the centre, a clue box above it
 * and the floor at a corner. A probe on an old arena reads its clue box or beam glass as the
 * ground, so the floor is looked for up to two blocks below; returns the real ground height.
 */
export function looksBuilt(
  idAt: (x: number, y: number, z: number) => string | undefined,
  pos: Vec3,
): number | undefined {
  const { x, z } = pos;
  return [pos.y, pos.y - 1, pos.y - 2].find((g) => (
    idAt(x, g, z) === BLOCK.ironBlock
    && CLUE_BOXES.includes(idAt(x, g + 1, z) ?? '')
    && idAt(x - half, g, z - half) === BLOCK.smoothStone));
}
