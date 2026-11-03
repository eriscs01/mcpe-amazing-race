// Tunable constants and tables from the spec. Rules read these; nothing here decides anything.
// Vanilla identifiers live only in the BLOCK / ITEM / ENTITY tables below, which
// test/ids.test.ts checks against vanilla-data for the oldest supported and the latest game.

/** Logged at load; must equal package.json and the manifest (checked by tests and packaging). */
export const ADDON_VERSION = '0.1.0';

// ── Vanilla identifiers ─────────────────────────────────────────────────────

export const BLOCK = {
  // desert
  sand: 'minecraft:sand',
  redSand: 'minecraft:red_sand',
  sandstone: 'minecraft:sandstone',
  redSandstone: 'minecraft:red_sandstone',
  terracotta: 'minecraft:hardened_clay', // plain terracotta keeps its legacy id on Bedrock
  whiteTerracotta: 'minecraft:white_terracotta',
  orangeTerracotta: 'minecraft:orange_terracotta',
  yellowTerracotta: 'minecraft:yellow_terracotta',
  brownTerracotta: 'minecraft:brown_terracotta',
  redTerracotta: 'minecraft:red_terracotta',
  lightGrayTerracotta: 'minecraft:light_gray_terracotta',
  // snowy
  snow: 'minecraft:snow',
  snowLayer: 'minecraft:snow_layer',
  ice: 'minecraft:ice',
  packedIce: 'minecraft:packed_ice',
  blueIce: 'minecraft:blue_ice',
  powderSnow: 'minecraft:powder_snow',
  // forest (also marked by passing leaves or logs on the way down)
  podzol: 'minecraft:podzol',
  // plains
  grassBlock: 'minecraft:grass_block',
  mycelium: 'minecraft:mycelium',
  // mountain
  stone: 'minecraft:stone',
  gravel: 'minecraft:gravel',
  andesite: 'minecraft:andesite',
  diorite: 'minecraft:diorite',
  granite: 'minecraft:granite',
  deepslate: 'minecraft:deepslate',
  tuff: 'minecraft:tuff',
  calcite: 'minecraft:calcite',
  // swamp
  mud: 'minecraft:mud',
  mangroveRoots: 'minecraft:mangrove_roots',
} as const;

export const ITEM = {
  clock: 'minecraft:clock',
  compass: 'minecraft:compass',
  // kit
  stonePickaxe: 'minecraft:stone_pickaxe',
  stoneAxe: 'minecraft:stone_axe',
  stoneShovel: 'minecraft:stone_shovel',
  stoneSword: 'minecraft:stone_sword',
  bread: 'minecraft:bread',
  // gather
  sand: 'minecraft:sand',
  redSand: 'minecraft:red_sand',
  snowball: 'minecraft:snowball',
  oakLog: 'minecraft:oak_log',
  spruceLog: 'minecraft:spruce_log',
  birchLog: 'minecraft:birch_log',
  jungleLog: 'minecraft:jungle_log',
  acaciaLog: 'minecraft:acacia_log',
  darkOakLog: 'minecraft:dark_oak_log',
  mangroveLog: 'minecraft:mangrove_log',
  cherryLog: 'minecraft:cherry_log',
  paleOakLog: 'minecraft:pale_oak_log',
  wheatSeeds: 'minecraft:wheat_seeds',
  cobblestone: 'minecraft:cobblestone',
  cobbledDeepslate: 'minecraft:cobbled_deepslate',
  dirt: 'minecraft:dirt',
  mud: 'minecraft:mud',
} as const;

export const ENTITY = {} as const satisfies Record<string, `minecraft:${string}`>;

export type BlockId = (typeof BLOCK)[keyof typeof BLOCK];
export type ItemId = (typeof ITEM)[keyof typeof ITEM];

// ── Time ────────────────────────────────────────────────────────────────────

export const TICKS_PER_SECOND = 20;
/** One race hour in race-clock ticks (30 real seconds). Used only for penalties. */
export const HOUR = 30 * TICKS_PER_SECOND;

/** Periodic save of the race clock (spec §13); real state changes are saved at once. */
export const SAVE_EVERY_TICKS = 5 * TICKS_PER_SECOND;

/** A form refused with UserBusy (chat open) is retried this often, for up to 5 s (§2.8). */
export const FORM_RETRY_TICKS = 10;
export const FORM_TRIES = (5 * TICKS_PER_SECOND) / FORM_RETRY_TICKS;

/** Uses of a menu item this close together count once (air use and block use can both fire). */
export const USE_DEBOUNCE_TICKS = 5;

/** Penalties in race hours (spec §8.8). Host-added penalties are chosen in the form. */
export const PENALTY_HOURS = {
  quitRoadblock: 4,
  quitDetour: 6,
  quitSpeedBump: 4,
  separation: 0.5,
  gliding: 0.5,
} as const;

// ── Host setup (spec §4) ────────────────────────────────────────────────────

export const SETUP = {
  sliders: {
    days: {
      min: 1, max: 5, step: 1, default: 3,
    },
    minutesPerDay: {
      min: 30, max: 120, step: 15, default: 60,
    },
    teamSize: {
      min: 2, max: 4, step: 1, default: 2,
    },
  },
  toggles: {
    hostRaces: false,
    daylightCycle: true,
  },
} as const;

/** Derived plan (spec §4) and elimination schedule (spec §8.6); not host options. */
export const PLAN = {
  /** Real minutes one leg is planned to take: legs per day = floor(minutes per day / this). */
  legMinutes: 30,
  legs: { min: 2, max: 12 },
  radius: {
    base: 1200, perLeg: 100, min: 1400, max: 2400,
  },
  /** Distance beyond the course radius where racers are warned, and where they are stopped. */
  boundary: { warn: 200, hard: 300 },
  /** Teams left in the final leg once eliminations are done. */
  finalists: 3,
} as const;

// ── Course walk (spec §5, §6.2, §6.4) ───────────────────────────────────────

/** Distances in blocks, angles in degrees. */
export const COURSE = {
  /** Straight-line length between consecutive stops. */
  segment: { min: 600, max: 900 },
  /** Least distance between any two stops. */
  spacing: 300,
  /** The Finish lies within this distance of the start line. */
  finishFromStart: 400,
  /** Past this share of the radius, the next heading turns back toward the start line... */
  driftBias: 0.6,
  /** ...within this many degrees either side. */
  driftCone: 60,
  /** Extra Route Info stops head toward the stop they lead to, within this many degrees. */
  insertCone: 60,
  /** Held back from the reach to a pin or the Finish, so the last segment has room to land. */
  reachMargin: 100,
  /** Probed candidates per stop, and how many valid ones are compared for flatness. */
  candidatesPerStop: 6,
  validToChoose: 3,
  /** Positions drawn for a candidate before the stop is given up as having no room. */
  proposalTries: 20,
  /** Look-ahead: draws per stop, and positions in all, when checking the rest still fits. */
  searchTries: 6,
  searchBudget: 400,
  /** Searches from a stop whose position was fixed (start line, pin) before giving up. */
  searchRestarts: 40,
} as const;

// ── Teams (spec §4) ─────────────────────────────────────────────────────────

export const TEAM_COLORS = [
  { name: 'Red', code: '§c' },
  { name: 'Blue', code: '§9' },
  { name: 'Green', code: '§a' },
  { name: 'Gold', code: '§6' },
  { name: 'Purple', code: '§5' },
  { name: 'Aqua', code: '§b' },
  { name: 'Pink', code: '§d' },
  { name: 'White', code: '§f' },
  { name: 'Gray', code: '§7' },
  { name: 'Jade', code: '§2' },
  { name: 'Teal', code: '§3' },
  { name: 'Maroon', code: '§4' },
] as const;

// ── Items and kit (spec §3, §8.1) ───────────────────────────────────────────

export interface MenuItem {
  readonly item: ItemId;
  readonly nameTag: string;
  readonly lore: readonly string[];
}

export const RACE_CONTROL: MenuItem = {
  item: ITEM.clock,
  nameTag: '§6Race Control',
  lore: ['Amazing Race host menu'],
};
export const PASSPORT: MenuItem = {
  item: ITEM.compass,
  nameTag: '§eRace Passport',
  lore: ['Amazing Race passport'],
};

export const KIT: readonly { readonly item: ItemId; readonly amount: number }[] = [
  { item: ITEM.stonePickaxe, amount: 1 },
  { item: ITEM.stoneAxe, amount: 1 },
  { item: ITEM.stoneShovel, amount: 1 },
  { item: ITEM.stoneSword, amount: 1 },
  { item: ITEM.bread, amount: 16 },
];

// ── Terrain (spec §5, §6.2, §7.2) ───────────────────────────────────────────

export const TERRAINS = ['desert', 'snowy', 'forest', 'plains', 'mountain', 'swamp'] as const;
export type Terrain = (typeof TERRAINS)[number];
export const TERRAIN_FALLBACK: Terrain = 'plains';

/** Ground blocks that classify a stop. Forest is also marked by passing leaves or logs. */
export const TERRAIN_BLOCKS: Record<Terrain, readonly BlockId[]> = {
  desert: [
    BLOCK.sand,
    BLOCK.redSand,
    BLOCK.sandstone,
    BLOCK.redSandstone,
    BLOCK.terracotta,
    BLOCK.whiteTerracotta,
    BLOCK.orangeTerracotta,
    BLOCK.yellowTerracotta,
    BLOCK.brownTerracotta,
    BLOCK.redTerracotta,
    BLOCK.lightGrayTerracotta,
  ],
  snowy: [BLOCK.snow, BLOCK.snowLayer, BLOCK.ice, BLOCK.packedIce, BLOCK.blueIce, BLOCK.powderSnow],
  forest: [BLOCK.podzol],
  plains: [BLOCK.grassBlock, BLOCK.mycelium],
  mountain: [
    BLOCK.stone,
    BLOCK.gravel,
    BLOCK.andesite,
    BLOCK.diorite,
    BLOCK.granite,
    BLOCK.deepslate,
    BLOCK.tuff,
    BLOCK.calcite,
  ],
  swamp: [BLOCK.mud, BLOCK.mangroveRoots],
};

/**
 * Place names are prefix + " " + suffix. Prefixes never repeat across terrains, so names stay
 * unique.
 */
export const TERRAIN_NAMES: Record<
  Terrain,
  { readonly prefixes: readonly string[]; readonly suffixes: readonly string[] }
> = {
  desert: {
    prefixes: [
      'Amber',
      'Sunscorch',
      'Mirage',
      'Copper',
      'Saffron',
      'Ochre',
      'Dustwind',
      'Bleached',
    ],
    suffixes: ['Dunes', 'Flats', 'Mesa', 'Basin', 'Wash', 'Sands', 'Oasis', 'Bluff'],
  },
  snowy: {
    prefixes: [
      'Frostpine',
      'Glacier',
      'Whiteout',
      'Rime',
      'Icefang',
      'Hoarfrost',
      'Snowdrift',
      'Coldwater',
    ],
    suffixes: ['Ridge', 'Hollow', 'Field', 'Pass', 'Shelf', 'Tundra', 'Drift', 'Peak'],
  },
  forest: {
    prefixes: [
      'Mossy',
      'Oakshade',
      'Fernwood',
      'Thornbush',
      'Elderbark',
      'Greenbough',
      'Owlwatch',
      'Timber',
    ],
    suffixes: ['Grove', 'Thicket', 'Glade', 'Woods', 'Clearing', 'Copse', 'Dell', 'Weald'],
  },
  plains: {
    prefixes: [
      'Meadow',
      'Goldengrass',
      'Windrow',
      'Clover',
      'Sunfield',
      'Hayward',
      'Brightvale',
      'Larkspur',
    ],
    suffixes: ['Green', 'Downs', 'Commons', 'Pasture', 'Heath', 'Lea', 'Prairie', 'Crossing'],
  },
  mountain: {
    prefixes: [
      'Granite',
      'Stormcrag',
      'Ironspire',
      'Eagle',
      'Slatefall',
      'Highstone',
      'Thunder',
      'Graywall',
    ],
    suffixes: ['Summit', 'Crag', 'Ledge', 'Cliffs', 'Spur', 'Scarp', 'Tor', 'Heights'],
  },
  swamp: {
    prefixes: ['Willow', 'Murk', 'Reedy', 'Bogwater', 'Mistmire', 'Cattail', 'Mangrove', 'Gloom'],
    suffixes: ['Fen', 'Marsh', 'Bayou', 'Mire', 'Slough', 'Bog', 'Wetland', 'Morass'],
  },
};

// ── Challenges (spec §7) ────────────────────────────────────────────────────

export const TASK_KINDS = [
  'archery',
  'parkour',
  'haystack',
  'hunt',
  'gather',
  'quiz',
  'recall',
] as const;
export type TaskKindName = (typeof TASK_KINDS)[number];

/** Gather requirement per terrain: `count` of any mix of `items`. */
export const GATHER: Record<
  Terrain,
  { readonly items: readonly ItemId[]; readonly count: number; readonly label: string }
> = {
  desert: { items: [ITEM.sand, ITEM.redSand], count: 32, label: 'sand or red sand' },
  snowy: { items: [ITEM.snowball], count: 16, label: 'snowballs' },
  forest: {
    items: [
      ITEM.oakLog,
      ITEM.spruceLog,
      ITEM.birchLog,
      ITEM.jungleLog,
      ITEM.acaciaLog,
      ITEM.darkOakLog,
      ITEM.mangroveLog,
      ITEM.cherryLog,
      ITEM.paleOakLog,
    ],
    count: 16,
    label: 'logs (any wood)',
  },
  plains: { items: [ITEM.wheatSeeds], count: 10, label: 'wheat seeds' },
  mountain: {
    items: [ITEM.cobblestone, ITEM.cobbledDeepslate],
    count: 32,
    label: 'cobblestone or cobbled deepslate',
  },
  swamp: { items: [ITEM.dirt, ITEM.mud], count: 32, label: 'dirt or mud' },
};

export interface DetourOption {
  readonly name: string;
  readonly kind: Exclude<TaskKindName, 'recall'>;
}

/** Detour pairs (option A / option B). The planner never uses the same pair twice in a row. */
export const DETOUR_PAIRS: readonly { readonly a: DetourOption; readonly b: DetourOption }[] = [
  { a: { name: 'Aim', kind: 'archery' }, b: { name: 'Climb', kind: 'parkour' } },
  { a: { name: 'Fight', kind: 'hunt' }, b: { name: 'Find', kind: 'haystack' } },
  { a: { name: 'Muscle', kind: 'gather' }, b: { name: 'Mind', kind: 'quiz' } },
  { a: { name: 'Dig', kind: 'haystack' }, b: { name: 'Shoot', kind: 'archery' } },
  { a: { name: 'Brains', kind: 'quiz' }, b: { name: 'Brawn', kind: 'hunt' } },
  { a: { name: 'Hike', kind: 'parkour' }, b: { name: 'Haul', kind: 'gather' } },
];

/** Roadblock kinds for legs 1 to L−1; the final leg's Roadblock is always recall. */
export const ROADBLOCK_KINDS = ['archery', 'parkour', 'haystack', 'quiz', 'hunt'] as const;
export type RoadblockKind = (typeof ROADBLOCK_KINDS)[number] | 'recall';

/** Shown before the performer is chosen. */
export const ROADBLOCK_HINTS: Record<RoadblockKind, string> = {
  archery: 'Who has a good eye?',
  parkour: "Who's light on their feet?",
  haystack: "Who's ready to dig deep?",
  quiz: "Who's the brains of this team?",
  hunt: "Who's ready for a fight?",
  recall: "Who's been paying attention?",
};
