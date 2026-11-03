// Terrain probe (spec §6.1-6.3): loads the area around a candidate with the one `race_scan`
// ticking area, then reads ground and landmark evidence from it. The rules (what counts as
// ground, terrain, a landmark) live in core/course; this file only touches the world.
/* eslint-disable no-await-in-loop -- polling waits one step at a time */
import { BlockVolume, system } from '@minecraft/server';

import { ENTITY, LANDMARK, LOAD } from '../core/config.js';
import { TickingAreaFull } from '../core/course/job.js';
import { LANDMARK_BLOCKS } from '../core/course/landmarks.js';
import { groundOf } from '../core/course/terrain.js';
import { horizontalDistance } from '../core/vec.js';

import type { Dimension } from '@minecraft/server';

import type { Found } from '../core/course/landmarks.js';
import type { Area, AreaLoader } from '../core/course/scan.js';
import type { Logger } from '../core/log.js';
import type { Vec3 } from '../core/vec.js';

/** Runs a command and reports whether it succeeded; a refused command is not an error here. */
function succeeded(dimension: Dimension, command: string, log?: Logger): boolean {
  try {
    return dimension.runCommand(command).successCount > 0;
  } catch (error) {
    // The caller decides whether this matters; a log shows the real cause when it does.
    log?.warn('commandFailed', { command, error: String(error) });
    return false;
  }
}

/** Reads the block id at a position, or undefined when its chunk is not loaded. */
function idAt(dimension: Dimension, x: number, y: number, z: number): string | undefined {
  try {
    return dimension.getBlock({ x, y, z })?.typeId;
  } catch {
    return undefined;
  }
}

function topAt(dimension: Dimension, x: number, z: number): number | undefined {
  try {
    return dimension.getTopmostBlock({ x, z })?.y;
  } catch {
    return undefined;
  }
}

const blockOf = (p: Vec3): Vec3 => ({
  x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z),
});

const HALF = 32;
const BELOW = 12;
const ABOVE = 11;

function entitiesNear(dimension: Dimension, pos: Vec3): Found[] {
  const types = [ENTITY.villager, ENTITY.villagerV2, ENTITY.ironGolem, ENTITY.pillager];
  return types.flatMap((type) => dimension.getEntities({
    location: pos, maxDistance: LANDMARK.scanRadius, type,
  }))
    // The spec's 48 blocks are horizontal; the query's distance is 3D.
    .filter((e) => horizontalDistance(e.location, pos) <= LANDMARK.scanRadius)
    .map((e) => ({ type: e.typeId, pos: blockOf(e.location) }));
}

/**
 * One position per landmark block type is all detection needs; badlands can hold tens of
 * thousands of matches, so only the first is read. A failing query is logged, once per loader.
 */
function blocksNear(
  dimension: Dimension,
  pos: Vec3,
  surface: number,
  onError: (type: string, error: unknown) => void,
): Found[] {
  const from = { x: pos.x - HALF, y: surface - BELOW, z: pos.z - HALF };
  const to = { x: pos.x + HALF - 1, y: surface + ABOVE, z: pos.z + HALF - 1 };
  return LANDMARK_BLOCKS.flatMap((type) => {
    try {
      const volume = dimension.getBlocks(new BlockVolume(from, to), { includeTypes: [type] }, true);
      const first = volume.getBlockLocationIterator().next();
      return first.done ? [] : [{ type, pos: first.value }];
    } catch (error) {
      onError(type, error);
      return [];
    }
  });
}

/** Loads candidates through one ticking area at a time. */
export class TickingAreaLoader implements AreaLoader {
  constructor(private readonly dimension: Dimension, private readonly log: Logger) {}

  async load(pos: Vec3): Promise<Area | undefined> {
    const { dimension } = this;
    this.close();
    const { areaName, radiusChunks } = LOAD;
    const command = `tickingarea add circle ${pos.x} 64 ${pos.z} ${radiusChunks} ${areaName} true`;
    // runCommand reports only success or failure; a failed add means the world is at its limit.
    if (!succeeded(dimension, command, this.log)) throw new TickingAreaFull();
    if (!await this.waitUntilReadable(pos)) {
      this.log.info('areaTimeout', { x: pos.x, z: pos.z });
      return undefined;
    }
    const onScanError = (type: string, error: unknown): void => this.blockScanFailed(type, error);
    return {
      groundAt: (x, z) => {
        const top = topAt(dimension, x, z);
        return top === undefined ? undefined : groundOf(top, (y) => idAt(dimension, x, y, z));
      },
      evidence: () => {
        const surface = topAt(dimension, pos.x, pos.z) ?? pos.y;
        return {
          entities: entitiesNear(dimension, pos),
          blocks: blocksNear(dimension, pos, surface, onScanError),
        };
      },
    };
  }

  private blockScanWarned = false;

  private blockScanFailed(type: string, error: unknown): void {
    if (this.blockScanWarned) return;
    this.blockScanWarned = true;
    this.log.warn('blockScanFailed', { type, error: String(error) });
  }

  /** Removes the scan's ticking area; a failure just means there was none. */
  close(): void {
    succeeded(this.dimension, `tickingarea remove ${LOAD.areaName}`);
  }

  /** Polls until the centre column reads, then waits for the surroundings to settle. */
  private async waitUntilReadable(pos: Vec3): Promise<boolean> {
    const limit = system.currentTick + LOAD.timeoutTicks;
    while (system.currentTick < limit) {
      if (topAt(this.dimension, pos.x, pos.z) !== undefined) {
        await system.waitTicks(LOAD.settleTicks);
        return true;
      }
      await system.waitTicks(LOAD.pollTicks);
    }
    return false;
  }
}
