// Invariants the spec places on the tunable tables. Values themselves live in config.ts;
// these tests only fail when a table stops satisfying a rule the race depends on.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DETOUR_PAIRS,
  GATHER,
  HOUR,
  KIT,
  PENALTY_HOURS,
  ROADBLOCK_HINTS,
  ROADBLOCK_KINDS,
  SETUP,
  TEAM_COLORS,
  TERRAIN_BLOCKS,
  TERRAIN_FALLBACK,
  TERRAIN_NAMES,
  TERRAINS,
  TICKS_PER_SECOND,
} from "../src/core/config.js";

const unique = <T>(xs: readonly T[]): boolean => new Set(xs).size === xs.length;

test("a race hour is 30 real seconds", () => {
  assert.equal(HOUR / TICKS_PER_SECOND, 30);
});

test("penalties match the spec in real seconds", () => {
  const seconds = Object.fromEntries(
    Object.entries(PENALTY_HOURS).map(([k, h]) => [k, (h * HOUR) / TICKS_PER_SECOND]),
  );
  assert.deepEqual(seconds, { quitRoadblock: 120, quitDetour: 180, quitSpeedBump: 120, separation: 15, gliding: 15 });
});

test("every setup default lies on its slider", () => {
  for (const [key, s] of Object.entries(SETUP.sliders)) {
    assert.ok(s.min <= s.default && s.default <= s.max, key);
    assert.equal((s.default - s.min) % s.step, 0, key);
    assert.equal((s.max - s.min) % s.step, 0, key);
  }
});

test("team colours are 12 distinct names and section-sign codes", () => {
  assert.equal(TEAM_COLORS.length, 12);
  assert.ok(unique(TEAM_COLORS.map((c) => c.name)));
  assert.ok(unique(TEAM_COLORS.map((c) => c.code)));
  for (const c of TEAM_COLORS) assert.match(c.code, /^§[0-9a-f]$/);
});

test("every terrain has a gather requirement and a name table", () => {
  for (const t of TERRAINS) {
    assert.ok(GATHER[t].items.length > 0 && GATHER[t].count > 0, t);
    assert.ok(TERRAIN_NAMES[t].prefixes.length > 0 && TERRAIN_NAMES[t].suffixes.length > 0, t);
  }
  assert.ok(TERRAINS.includes(TERRAIN_FALLBACK));
});

test("each ground block classifies into exactly one terrain", () => {
  const all = Object.values(TERRAIN_BLOCKS).flat();
  assert.ok(unique(all), "a block is listed under two terrains");
});

test("place names can stay unique for the largest course, even if every stop shares a terrain", () => {
  const maxStops = 4 * 12 + 1; // 12 legs × 4 stops + start line
  for (const t of TERRAINS) {
    const { prefixes, suffixes } = TERRAIN_NAMES[t];
    assert.ok(prefixes.length * suffixes.length >= maxStops, t);
  }
});

test("place names are unique across terrains", () => {
  const prefixes = TERRAINS.flatMap((t) => TERRAIN_NAMES[t].prefixes);
  assert.ok(unique(prefixes), "prefixes repeat across terrains, so two terrains can produce the same name");
  for (const t of TERRAINS) assert.ok(unique(TERRAIN_NAMES[t].suffixes), t);
});

test("detour pairs offer two different kinds under distinct option names", () => {
  assert.equal(DETOUR_PAIRS.length, 6);
  for (const p of DETOUR_PAIRS) assert.notEqual(p.a.kind, p.b.kind, `${p.a.name} / ${p.b.name}`);
  assert.ok(unique(DETOUR_PAIRS.map((p) => `${p.a.name}/${p.b.name}`)));
});

test("every roadblock kind, plus recall, has a hint", () => {
  for (const k of [...ROADBLOCK_KINDS, "recall" as const]) assert.ok(ROADBLOCK_HINTS[k].length > 0, k);
});

test("the starter kit is the spec's tools and bread", () => {
  assert.deepEqual(
    KIT.map((k) => [k.item.replace("minecraft:", ""), k.amount]),
    [["stone_pickaxe", 1], ["stone_axe", 1], ["stone_shovel", 1], ["stone_sword", 1], ["bread", 16]],
  );
});
