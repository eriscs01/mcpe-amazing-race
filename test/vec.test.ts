import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  distance,
  horizontalDistance,
  normalizeYaw,
  offsetByYaw,
  relativeYaw,
  yawToDirection,
  yawTowards,
} from '../src/core/vec.js';

const near = (actual: number, expected: number, eps = 1e-9): void =>
  assert.ok(Math.abs(actual - expected) < eps, `expected ${expected}, got ${actual}`);

test('distance() is 3D, horizontalDistance() ignores height', () => {
  const a = { x: 0, y: 0, z: 0 };
  const b = { x: 3, y: 12, z: 4 };
  near(distance(a, b), 13);
  near(horizontalDistance(a, b), 5);
});

test('normalizeYaw() maps any angle into (-180, 180]', () => {
  near(normalizeYaw(0), 0);
  near(normalizeYaw(180), 180);
  near(normalizeYaw(-180), 180);
  near(normalizeYaw(270), -90);
  near(normalizeYaw(-450), -90);
  near(normalizeYaw(720 + 45), 45);
});

// Bedrock yaw: 0 = south (+Z), 90 = west (-X), -90 = east (+X), 180 = north (-Z).
const cardinals = [
  { name: 'south', yaw: 0, dir: { x: 0, z: 1 } },
  { name: 'west', yaw: 90, dir: { x: -1, z: 0 } },
  { name: 'east', yaw: -90, dir: { x: 1, z: 0 } },
  { name: 'north', yaw: 180, dir: { x: 0, z: -1 } },
];

for (const c of cardinals) {
  test(`yawToDirection(${c.yaw}) points ${c.name}`, () => {
    const d = yawToDirection(c.yaw);
    near(d.x, c.dir.x);
    near(d.z, c.dir.z);
  });

  test(`yawTowards() a target due ${c.name} is ${c.yaw}`, () => {
    const from = { x: 10, y: 64, z: -20 };
    const to = { x: from.x + c.dir.x * 50, y: 70, z: from.z + c.dir.z * 50 };
    near(yawTowards(from, to), c.yaw);
  });
}

test('yawToDirection(0) is exactly due south, with no negative zero', () => {
  assert.deepEqual(yawToDirection(0), { x: 0, z: 1 });
});

test('relativeYaw() is the signed turn from facing to target', () => {
  near(relativeYaw(0, 90), 90);
  near(relativeYaw(170, -170), 20);
  near(relativeYaw(-170, 170), -20);
  near(relativeYaw(0, 180), 180);
});

test('offsetByYaw() moves the given distance along the heading', () => {
  const origin = { x: 100, y: 64, z: 100 };
  const p = offsetByYaw(origin, 90, 750);
  near(p.x, -650);
  near(p.z, 100);
  assert.equal(p.y, 64);
  near(horizontalDistance(origin, offsetByYaw(origin, 33.3, 600)), 600);
  near(yawTowards(origin, offsetByYaw(origin, -120, 600)), -120);
});
