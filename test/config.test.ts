// Spec tables: invariants the race depends on, then exact values from the spec so an
// accidental edit to a table fails a test.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DETOUR_PAIRS,
  GATHER,
  HOUR,
  KIT,
  PASSPORT,
  RACE_CONTROL,
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

test("team colours match spec §4 in order", () => {
  assert.deepEqual(
    TEAM_COLORS.map((c) => `${c.name} ${c.code}`),
    ["Red §c", "Blue §9", "Green §a", "Gold §6", "Purple §5", "Aqua §b", "Pink §d", "White §f", "Gray §7", "Jade §2", "Teal §3", "Maroon §4"],
  );
});

test("setup sliders and toggles match spec §4", () => {
  const sliders = Object.fromEntries(
    Object.entries(SETUP.sliders).map(([k, s]) => [k, [s.min, s.max, s.step, s.default]]),
  );
  assert.deepEqual(sliders, { days: [1, 5, 1, 3], minutesPerDay: [30, 120, 15, 60], teamSize: [2, 4, 1, 2] });
  assert.deepEqual(SETUP.toggles, { hostRaces: false, daylightCycle: true });
});

test("menu items match spec §3", () => {
  assert.deepEqual(RACE_CONTROL, { item: "minecraft:clock", nameTag: "§6Race Control", lore: ["Amazing Race host menu"] });
  assert.deepEqual(PASSPORT, { item: "minecraft:compass", nameTag: "§eRace Passport", lore: ["Amazing Race passport"] });
});

test("gather requirements match spec §7.2", () => {
  const short = (id: string): string => id.replace("minecraft:", "");
  const table = Object.fromEntries(TERRAINS.map((t) => [t, [GATHER[t].count, GATHER[t].items.map(short)]]));
  const logs = ["oak", "spruce", "birch", "jungle", "acacia", "dark_oak", "mangrove", "cherry", "pale_oak"].map((w) => `${w}_log`);
  assert.deepEqual(table, {
    desert: [32, ["sand", "red_sand"]],
    snowy: [16, ["snowball"]],
    forest: [16, logs],
    plains: [10, ["wheat_seeds"]],
    mountain: [32, ["cobblestone", "cobbled_deepslate"]],
    swamp: [32, ["dirt", "mud"]],
  });
});

test("detour pairs match spec §7.3", () => {
  assert.deepEqual(
    DETOUR_PAIRS.map((p) => `${p.a.name}/${p.b.name} ${p.a.kind}/${p.b.kind}`),
    [
      "Aim/Climb archery/parkour",
      "Fight/Find hunt/haystack",
      "Muscle/Mind gather/quiz",
      "Dig/Shoot haystack/archery",
      "Brains/Brawn quiz/hunt",
      "Hike/Haul parkour/gather",
    ],
  );
});

test("roadblock kinds and hints match spec §7.3", () => {
  assert.deepEqual([...ROADBLOCK_KINDS], ["archery", "parkour", "haystack", "quiz", "hunt"]);
  assert.deepEqual(ROADBLOCK_HINTS, {
    archery: "Who has a good eye?",
    parkour: "Who's light on their feet?",
    haystack: "Who's ready to dig deep?",
    quiz: "Who's the brains of this team?",
    hunt: "Who's ready for a fight?",
    recall: "Who's been paying attention?",
  });
});
