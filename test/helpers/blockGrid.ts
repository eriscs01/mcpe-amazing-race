// Stand-in for the world's blocks: a sparse grid over a flat grass plain, implementing the
// BlockWorld the arena builder drives.
import { BLOCK } from '../../src/core/config.js';

import type { BlockWorld } from '../../src/core/arena/layout.js';
import type { Vec3 } from '../../src/core/vec.js';

export class BlockGrid implements BlockWorld {
  readonly blocks = new Map<string, string>();

  readonly minY = -64;

  readonly maxY = 319;

  constructor(readonly ground = 64, private readonly belowGround: string = BLOCK.grassBlock) {}

  private static key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  idAt(x: number, y: number, z: number): string {
    const set = this.blocks.get(BlockGrid.key(x, y, z));
    if (set !== undefined) return set;
    return y <= this.ground ? this.belowGround : BLOCK.air;
  }

  put(x: number, y: number, z: number, id: string): void {
    this.blocks.set(BlockGrid.key(x, y, z), id);
  }

  set(pos: Vec3, block: string): void {
    this.put(pos.x, pos.y, pos.z, block);
  }

  fill(from: Vec3, to: Vec3, block: string, only?: readonly string[]): void {
    for (let { x } = from; x <= to.x; x += 1) {
      for (let { y } = from; y <= to.y; y += 1) {
        for (let { z } = from; z <= to.z; z += 1) {
          if (!only || only.includes(this.idAt(x, y, z))) this.put(x, y, z, block);
        }
      }
    }
  }

  topY(x: number, z: number): number {
    let y = this.maxY;
    while (y > this.minY && this.idAt(x, y, z) === BLOCK.air) y -= 1;
    return y;
  }

  /** Every non-default block in the grid. */
  count(id: string): number {
    return [...this.blocks.values()].filter((b) => b === id).length;
  }
}
