// Positions and headings in Bedrock conventions.
// Yaw is in degrees: 0 = south (+Z), 90 = west (−X), −90 = east (+X), ±180 = north (−Z).

/** Structurally compatible with the Script API's Vector3, so the adapter can pass either way. */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

const RAD = Math.PI / 180;

export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Distance on the X/Z plane; height is ignored. */
export function horizontalDistance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Maps any angle into (−180, 180]. */
export function normalizeYaw(yaw: number): number {
  const r = ((((yaw + 180) % 360) + 360) % 360) - 180;
  return r === -180 ? 180 : r + 0; // + 0 turns −0 into 0
}

/** Unit direction on the X/Z plane for a yaw. */
export function yawToDirection(yaw: number): { x: number; z: number } {
  return { x: 0 - Math.sin(yaw * RAD), z: Math.cos(yaw * RAD) }; // 0 - avoids −0 due south
}

/** Yaw that faces from `from` towards `to`. */
export function yawTowards(from: Vec3, to: Vec3): number {
  return normalizeYaw(Math.atan2(-(to.x - from.x), to.z - from.z) / RAD);
}

/** Signed turn from `facing` to `target`, in (−180, 180]; positive = target is to the right. */
export function relativeYaw(facing: number, target: number): number {
  return normalizeYaw(target - facing);
}

/** The point `dist` blocks from `origin` along `yaw`, at the same height. */
export function offsetByYaw(origin: Vec3, yaw: number, dist: number): Vec3 {
  const d = yawToDirection(yaw);
  return { x: origin.x + d.x * dist, y: origin.y, z: origin.z + d.z * dist };
}
