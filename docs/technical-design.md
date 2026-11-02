# Amazing Race Add-on — Technical Design

Companion to [amazing-race-addon-spec.md](amazing-race-addon-spec.md) (the **spec**). The spec says *what* to build; this document says *how the code is shaped* and *in which order to build it*. Where they conflict, the spec wins on behaviour and this document wins on structure.

---

## 1. Research findings (checked against installed typings)

Checked in `node_modules/@minecraft/server@2.0.0` and `@minecraft/server-ui@2.0.0`:

| Need | Stable 2.0.0 API | Notes |
|---|---|---|
| Gamerules snapshot/restore | `world.gameRules.{keepInventory, showCoordinates, doDayLightCycle}` | No `/gamerule` commands needed. Note the capital **L** in `doDayLightCycle`. |
| Arena build | `Dimension.fillBlocks(volume, block, options?)`, `Dimension.setBlockType` | `fillBlocks` caps at 32,768 blocks per call; an arena clear (19×19×14 = 5,054) fits. |
| Long-running work | `system.runJob(generator)`, `system.waitTicks` | Arena builds as `runJob` generators (yield every few fills); generation as `async` + `waitTicks`. |
| Landmark scan | `Dimension.getBlocks(volume, filter, allowUnloaded?)`, `getEntities({location, maxDistance, type})` | Throws `LocationInUnloadedChunkError` — wrap. |
| Ground finding | `Dimension.getTopmostBlock({x,z}, minHeight?)` | Returns `undefined` when unloaded. |
| Movement lock | `player.inputPermissions.setPermissionCategory(InputPermissionCategory.Movement, false)` | `LateralMovement`/`Jump` also exist; `Movement` covers all. |
| Private particles | `Player.spawnParticle(id, loc, molang?)` | Visible only to that player. |
| Clue boxes | `world.beforeEvents.playerInteractWithBlock` (`isFirstEvent`, `cancel`) | Before-events are read-only: mutate in `system.run`. |
| Forms | `ModalFormData.textField(label, placeholder, opts?)`, `dropdown(label, items, opts?)`, `slider(label, min, max, opts?)`, `toggle(label, opts?)` | `show()` rejects/cancels with `UserBusy` when chat is open → retry wrapper. |
| Ticking areas | **No API** — `dimension.runCommand("tickingarea add circle …")` | Only `successCount` is readable; 0 = failure (e.g. limit of 10 reached). |
| Persistence | `world.setDynamicProperty(id, string)` | Spec's 30,000-char chunks stay under the 32,767 limit. |
| Difficulty | `world.getDifficulty()` | Peaceful → exclude hunt. |

Still **[Verify first]** in-game (cannot be settled from typings): `itemUse` on Clock/Compass in air (spec §3), beacon beam through the cleared column, `projectileHitBlock` source for player-shot arrows, `Player.nameTag` colouring visible to others, ticking-area load latency.

Toolchain notes: `tsconfig` uses `NodeNext`, so relative imports must end in `.js` (Bedrock resolves these fine). TypeScript 7 is the native (`tsgo`) compiler — keep to plain TS features, no decorators or emit plugins.

---

## 2. Architecture

### 2.1 Core rule: pure core, thin Minecraft adapter

```
             ┌──────────────── src/mc/ (imports @minecraft/*) ────────────────┐
 events ───► │ wiring.ts → dispatch(Action) ─┐        ┌─ effects executor ──────┼──► world
 ticks  ───► │ loop.ts   → dispatch(Tick)  ──┤        │  (blocks, tp, forms,    │
 forms  ───► │ ui/*.ts   → dispatch(Choice)──┤        │   HUD, scoreboard)      │
             └───────────────────────────────┼────────┼─────────────────────────┘
                                             ▼        ▲
             ┌──────────────── src/core/ (NO @minecraft imports) ──────────────┐
             │ race engine: (state, action, ctx) → { state', effects[] }       │
             │ plan · schedule · course planner · tasks · quiz · hud math      │
             └─────────────────────────────────────────────────────────────────┘
```

- `src/core/**` never imports `@minecraft/*`. It receives plain data (positions, player ids, block type ids) and returns new state plus a list of **effects** (`{kind:"tp", player, pos}`, `{kind:"chat", text}`, `{kind:"build", stopId}` …).
- `src/mc/**` translates Minecraft events into core actions and executes effects. It holds no game rules.
- Benefit: the spec §14.3 full-race simulation runs in plain Node against `core` with a fake world — no module stubbing or loader hacks. `test/core-boundary.test.ts` enforces the boundary (no `@minecraft/*` or adapter imports under `src/core`), so it runs locally and in CI.

### 2.2 Source layout

```
src/
  main.ts                 entry: subscribe events at top level, init in worldLoad
  core/
    config.ts             constants & tables (colours, terrain, gather, detour pairs, hints, penalties, kit)
    types.ts              State, Team, Stop, Task, Settings, Effect, Action
    rng.ts                seeded PRNG (mulberry32); seed stored in state
    vec.ts                distance, heading, yaw→direction
    plan.ts               derived plan (legs, radius, boundary) + elimination schedule
    teams.ts              auto-assign, swap, roadblock caps
    course/planner.ts     stop sequence, segment walk, pinned waypoints, names, task assignment
    course/terrain.ts     ground walk + classification from a column sample (pure)
    tasks/*.ts            one file per kind: setup spec + progress reducer + completion
    quiz/bank.ts          trivia (≥30, verified), arithmetic, anagram generators, normaliser
    race/engine.ts        reducer: clue box, step advance, check-in, leg end, departures
    race/advantages.ts    U-Turn, Express Pass, Speed Bump
    race/rules.ts         separation, boundary, glide penalty (pure decisions)
    hud.ts                compass bar, task line, clue text
    clock.ts              race clock, timers keyed to clock ticks
  mc/
    loop.ts               single runInterval(1): advance clock, run periodic systems by modulo
    store.ts              chunked dynamic-property persistence, dirty flag
    items.ts              Race Control / Passport create + recognise
    world.ts              effect executor, block/entity helpers, safe chunk access
    terrainProbe.ts       ticking area load + column sampling + landmark scan
    builder.ts            arena build/lighting as runJob generators, retry queue
    protect.ts            break/place cancellation, mob sweep, item sweep
    ui/host.ts, ui/racer.ts, ui/forms.ts (UserBusy retry, phase-aware menus)
test/
  *.test.ts               node:test unit tests for core
  sim/fakeWorld.ts        flat-terrain world + scripted players
  sim/fullRace.test.ts    §14.3 scenario: 9 players, team size 3, 3 days
```

The spec's suggested modules (`config/state/course/tasks/race/hud/ui/util`) map onto this; the only change is splitting each into a pure half and an adapter half.

### 2.3 State model (persisted)

```ts
type Phase = "setup" | "generating" | "ready" | "running" | "paused" | "dayEnded" | "finished";

interface State {
  v: 1;                                   // schema version for future migration
  hostId?: string; phase: Phase; seed: number;
  settings: Settings; plan?: Plan;        // plan: legs, legsPerDay, radius, eliminationLegs[]
  clock: number; day: number; dayStartClock: number;
  snapshot?: { rules: Record<string, boolean>; time: number };
  start?: Vec3; pins: Vec3[];
  stops: Stop[];                          // flat list; leg + order index, no fixed 4-per-leg assumption
  teams: Team[];
  players: Record<string, { name: string; teamId?: string; lastPos?: Vec3; inBoundsPos?: Vec3; savedPos?: Vec3 }>;
  leg: { n: number; phase: "racing" | "grace" | "rest" | "departing"; graceEnd?: number; restEnd?: number };
}
interface Stop { id: number; leg: number; type: "start"|"route"|"detour"|"roadblock"|"pit"|"finish";
  pos: Vec3; terrain: Terrain; name: string; landmark?: Landmark; blind: boolean;
  task?: TaskSpec; built: boolean; lit: boolean; }
interface Team { id: string; name: string; color: string; members: string[]; status: "racing"|"checkedIn"|"eliminated";
  leg: number; step: number;              // index into the leg's stops
  penaltyOwed: number;                     // clock ticks
  checkIns: { leg: number; clock: number; place: number }[];
  roadblockCounts: Record<string, number>; performer?: string;
  expressPass?: { expiresLeg: number }; uTurnUsed: boolean; uTurnedAt?: number;
  speedBump: boolean; progress: Record<string, TaskProgress>; // key: `${stopId}:${option}`
  departAt?: number; lastClearedStop: number; lockoutUntil?: number; }
```

Transient (not persisted): open forms, separation timers, HUD caches, retry queues — all rebuildable from State.

### 2.4 Runtime loop and timing

- One `system.runInterval(fn, 1)`. While `phase === "running"` and the day is open, `state.clock++`. All timers compare against `clock`, never `system.currentTick`, so pause and multi-day are free.
- Periodic systems run by modulo: HUD 5 · parkour standing check 10 · trail 20 · last-in-bounds/boundary 40 · lighting retry 40 · save 100 · mob sweep 100 · elytra/pearl sweep 200 · separation 20.
- 1 race hour = 600 ticks (30 s); `config.ts` holds `HOUR = 600`.

### 2.5 Event handling rules

- Subscribe at module top level in `main.ts`; handlers return immediately if `state` is not yet loaded.
- `beforeEvents` handlers only decide `cancel` from in-memory state, then `system.run(() => dispatch(...))`.
- Every dispatch marks state dirty; `store.save()` runs at end of the tick if dirty (spec: "immediately after any state change") and every 100 ticks regardless.
- All world reads that can hit unloaded chunks go through `safe(fn)` which catches `LocationInUnloadedChunkError` / `undefined` and returns `undefined`.

### 2.6 Course generation pipeline

1. `planner.ts` (pure) produces the **skeleton**: ordered stop types per leg, pinned waypoint placement, task kinds, blind flags, Recall on final leg, hunt excluded on Peaceful.
2. For each stop, the planner proposes candidates (heading, distance) from a seeded RNG; `terrainProbe.ts` loads each via the `race_scan` ticking area and returns a `ColumnSample` + landmarks; `terrain.ts` (pure) accepts/rejects and classifies.
3. Names drawn from terrain tables, unique per course.
4. Builder enqueues arena builds; each is a `runJob` generator. The host sees "Generating stop k/N…" on the action bar.
5. Generation is resumable: progress is in `state.stops`; if the world reloads mid-generation, the host re-runs Generate and finished stops are kept.

### 2.7 Tasks as plug-ins

```ts
interface TaskKind<P> {
  setup(stop, zone, team, ctx): Effect[];            // build course / spawn husks / give bow
  onEvent(p: P, ev: TaskEvent, who: PlayerId): P;    // hit, break, kill, stand, answer
  done(p: P, params): boolean;
  progressText(p: P, params): string;                // "Aim: targets 3/5"
}
```

Detour, Roadblock, Speed Bump and Recall reuse the same interface; the engine only knows "eligible players" (any member / performer) and "kind". Adding or tuning a challenge touches one file.

### 2.8 Forms

- `forms.ts` wraps `show()` with a `UserBusy` retry (every 10 ticks, up to 5 s) and ignores cancelled responses.
- Host menu is built from `phase` → list of `{label, handler}`; racer Passport shows team, leg, current clue, advantages, and clue-box screens are routed by the stop type and team progress.
- Forms never mutate state directly; they dispatch actions so the same validation runs as for tests.

### 2.9 Testing strategy

| Layer | How |
|---|---|
| Pure core | `node:test` unit tests (plan math, schedule, caps, U-Turn targets, Express expiry, quiz normaliser, compass bar, chunked store round trip). |
| Full race | `test/sim/fullRace.test.ts`: fake world with flat terrain, scripted players walking to targets and completing tasks; asserts §14.3 outcomes. |
| Type safety | `npm run typecheck` against 2.0.0 typings (already in CI). |
| Identifiers | Vanilla ids live only in the `BLOCK` / `ITEM` / `ENTITY` tables in `config.ts`. `test/ids.test.ts` checks each against `@minecraft/vanilla-data` for the oldest supported game (1.21.90, installed as the `vanilla-data-min` alias) and the latest, and fails if any other `minecraft:` string appears in `config.ts`. vanilla-data has no particle list: particle ids get a hand-verified table with a source comment. |
| In-game | Checklist in `docs/ingame-test.md`, run per milestone on 1.21.90+ with 2 players. |

Tooling: `tsconfig.test.json` compiles `src/core` + `test` to `build/test`; `npm test` = clean build + `node --test` over `build/test/test/**/*.test.js` (Node ≥ 22). `npm run typecheck` checks both projects. `npm run lint` (`biome check`) is the code-quality gate: Biome's recommended rules plus an Airbnb-style format check (2-space indent, single quotes, semicolons, trailing commas, 100 columns, arrow parens always; `npm run format` applies it), warnings fail (`noNonNullAssertion` is off because `noUncheckedIndexedAccess` makes `!` the explicit marker for a proven in-range index; ESLint's TypeScript plugin can't run on TypeScript 7). `npm run coverage` runs the tests under c8, source-mapped to `src/core/*.ts`, and fails below 80% line coverage, counting untested core files. CI runs typecheck, lint, coverage and package in the required `build` check; GitHub Code Quality and its coverage upload aren't available for this personal repository.

---

## 3. Spec ambiguities and the decision taken

| Topic | Decision |
|---|---|
| Pinned waypoints / extra Route Info change stops per leg | Stops are a flat list with `leg` + order; a leg is "stops until its pit/finish". |
| "Last team" when a team has nobody online | Counts as not checked in; grace period applies; host can Skip/Teleport/Eliminate. |
| Placement when penalty-serving teams overlap | Placement = order of `checkInComplete` clock tick; ties broken by arrival tick. |
| Speed Bump location | The next leg's first Route Info clue box. |
| Archery wall for zone B | Zone A uses x−9, zone B uses x+9 (outer walls). |
| Haystack wool refill | Rebuild the zone's pile when hidden count reaches 0 and some team still needs it. |
| Sidebar entries | Fake-player scores keyed by coloured team name; `[OUT]` prefix re-keys the entry. |
| RNG | Seeded and stored, so a course and quiz draw can be reproduced for bug reports. |

---

## 4. Implementation groups

Small, independently reviewable PRs. Each leaves `main` building, type-checked and tested. ✱ = in-game check needed before merge.

| # | Group | Contents (spec §) | Depends on | Size |
|---|---|---|---|---|
| **G1** | Foundations | Layout from 2.2, `config.ts` tables, `rng`, `vec`, test tooling + CI (`npm test`, core-boundary grep, vanilla-data id test) | — | S |
| **G2** | State, clock & persistence | `types.ts`, chunked store (§13), main loop & race clock (§11), phase machine skeleton, schema version | G1 | S |
| **G3** | Items, host & menu shell ✱ | Race Control / Passport, host claim/replace/transfer, `/scriptevent race:host`, `itemUse` verification + fallback (§3), phase-aware empty menus, `UserBusy` wrapper | G2 | S |
| **G4** | Setup & teams | Setup form, derived plan display, elimination schedule (§4, §8.6), auto-assign/swap/view teams, colours, Roadblock cap math | G3 | S |
| **G5** | Course planner (pure) | Stop skeleton, segment walk, radius/spacing/finish rules, pinned waypoints, blind segments, Detour/Roadblock/Recall assignment, names (§5, §6.4, §7.3) | G1 | M |
| **G6** | Terrain probe & generation job ✱ | Ticking area load, ground walk, classification, landmark scan, arena offset, progress bar, add-landmark & list-stops screens (§6.1–6.3) | G4, G5 | M |
| **G7** | Arena build & lighting ✱ | 19×19 arena, beacon/glass/flags/torches/mat, zones, lit/unlit with chunk retry queue (§6.5–6.6) | G6 | M |
| **G8** | Race start & core loop ✱ | Gamerule snapshot, kit, countdown, clue box interaction + presence rule, Route Info, clue text, step advance, sidebar, chat broadcasts (§8.1–8.3, §10). *First playable: route-info-only race.* | G7 | M |
| **G9** | HUD & navigation ✱ | Compass bar, distance, task line, particle trail, blind segments (§9.1) | G8 | S |
| **G10** | Pit Stop & leg end | Check-in, penalty countdown, placement, rewards, grace, elimination vs. Speed Bump assignment, rest, staggered departures, finish/winner (§8.4–8.5) | G8 | M |
| **G11** | Task framework + physical tasks ✱ | `TaskKind` interface, zones, Archery, Parkour, Haystack (§7.1) | G8 | M |
| **G12** | Combat & inventory tasks ✱ | Hunt (husk tagging, respawn), Gather (terrain table, hand-in) (§7.1–7.2) | G11 | S |
| **G13** | Quiz & Recall | Question bank (≥30 verified trivia), arithmetic, anagrams, normaliser/aliases, lockouts, Recall dropdowns (§7.1) | G11 | S |
| **G14** | Detour & Roadblock flow | Option choice/switch with kept progress, quit penalties, performer pick + hints + caps, eligibility (§7.3, §8.2) | G11 | S |
| **G15** | Advantages | U-Turn board & targeting, Express Pass award/use/expiry, Speed Bump quiz (§8.7) | G10, G13, G14 | S |
| **G16** | Rules enforcement ✱ | Boundary + last in-bounds, dimension return, separation with exemptions, elytra/pearl sweep, glide penalty, arena protection, mob sweep (§7.4, §9.2–9.4) | G10 | M |
| **G17** | Sessions & lifecycle ✱ | End/resume day (both cases), pause, minutes reminder, death/respawn, rejoin, host Team fixes & Status, End race restore (§4, §11, §12) | G10, G16 | M |
| **G18** | Full-race simulation & release | `fakeWorld` + §14.3 scenario, in-game checklist, README usage section, packaged `.mcaddon` | all | M |

### Suggested order and milestones

```
G1 ─► G2 ─► G3 ─► G4 ─┐
G1 ─► G5 ─────────────┴► G6 ─► G7 ─► G8 ─┬► G9
                                          ├► G10 ─┬► G16 ─► G17 ─┐
                                          └► G11 ─┼► G12          ├► G18
                                                  ├► G13 ─┐       │
                                                  └► G14 ─┴► G15 ─┘
```

- **M1 — Walking skeleton (G1–G8):** host sets up, generates a real course, racers follow Route Info clues to beacons. First in-game milestone.
- **M2 — A real leg (G9–G14):** navigation, every challenge kind, Pit Stop placements and eliminations.
- **M3 — The full show (G15–G17):** advantages, rules enforcement, multi-day play.
- **M4 — Release (G18):** simulation-verified, packaged.

G5 and G2–G4 can proceed in parallel; after G8, the G9/G10/G11 branches are independent.
