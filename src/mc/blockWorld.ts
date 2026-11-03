// The arena builder's view of the world: a Dimension behind the core's BlockWorld interface.
import { BlockVolume } from '@minecraft/server';

import type { Dimension } from '@minecraft/server';

import type { BlockWorld } from '../core/arena/layout.js';
import type { BlockId } from '../core/config.js';
import type { Vec3 } from '../core/vec.js';

export class DimensionWorld implements BlockWorld {
  readonly minY: number;

  readonly maxY: number;

  constructor(private readonly dimension: Dimension) {
    this.minY = dimension.heightRange.min;
    // heightRange.max is exclusive.
    this.maxY = dimension.heightRange.max - 1;
  }

  /** The block id, or undefined when its chunk is not loaded. */
  idAt(x: number, y: number, z: number): string | undefined {
    try {
      return this.dimension.getBlock({ x, y, z })?.typeId;
    } catch {
      return undefined;
    }
  }

  set(pos: Vec3, block: BlockId): void {
    this.dimension.setBlockType(pos, block);
  }

  fill(from: Vec3, to: Vec3, block: BlockId, only?: readonly BlockId[]): void {
    this.dimension.fillBlocks(
      new BlockVolume(from, to),
      block,
      only ? { blockFilter: { includeTypes: [...only] } } : undefined,
    );
  }

  topY(x: number, z: number): number {
    return this.dimension.getTopmostBlock({ x, z })?.y ?? this.minY;
  }
}
