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

Toolchain notes: `tsconfig` uses `NodeNext`, so relative imports must end in `.js` (Bedrock resolves these fine). TypeScript is pinned to 6.0 (the last release with the JavaScript compiler API, which ESLint's TypeScript plugin needs); keep to plain TS features, no decorators or emit plugins, so moving to TypeScript 7 later is a version bump.

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
    types.ts              State, Team, Stop, Task, Settings, Effect, Action, schema version
    state.ts              createState: a new race, and the defaults older saves are filled from
    phase.ts              phase machine: allowed lifecycle transitions
    persist.ts            chunked JSON save/load over a PropertyBag, validation, additive defaults
    session.ts            live state holder: load, dispatch → reduce → effects, save timing
    log.ts                Logger (event + key=value fields keyed by race clock) and guard()
    items.ts              Race Control / Passport recognition (type + name tag + lore), plain clock
    host.ts               host claim / replace / transfer, Passport on rejoin
    menu.ts               item-use routing, phase-aware host menu + Passport models (HOST_ENTRIES)
    retry.ts              bounded retry while busy (forms' UserBusy)
    rng.ts                seeded PRNG (mulberry32); seed stored in state
    vec.ts                distance, heading, yaw→direction
    plan.ts               derived plan (legs, radius, boundary) + elimination schedule, summary
    setup.ts              Setup form model, reading its values, saving settings
    generation.ts         landmarks, starting a job, its result, discarding the course, stop list, failure texts
    teams.ts              auto-assign, swap, View teams text, roadblock caps
    course/skeleton.ts    stop types per leg, blind flags, Detour / Roadblock / Recall, pin slots
    course/layout.ts      distance rules, candidate draws, look-ahead search (geometry only)
    course/walk.ts        places stops from probe results: a generator the generation job drives
    course/names.ts       unique place names from the terrain tables
    course/terrain.ts     ground walk + classification + site assessment from block ids (pure)
    course/landmarks.ts   landmark detection from scan evidence, arena offset spots (pure)
    course/scan.ts        probes one candidate through an `AreaLoader` (ground, landmark, offset)
    course/job.ts         drives the walk across ticks over a `ProbeSource` (async)
    arena/layout.ts       arena as block operations (build, light), zones, `looksBuilt`, over a `BlockWorld` (pure)
    arena/lighting.ts     `RetryQueue`: latest lit/unlit wish per stop, retried until applied (pure)
    arenas.ts             arena state: build results, Build arenas, `setLit`, resume after reload
    tasks/*.ts            one file per kind: setup spec + progress reducer + completion
    quiz/bank.ts          trivia (≥30, verified), arithmetic, anagram generators, normaliser
    race/engine.ts        reducer: routes actions; check-in, leg end, departures come with G10
    race/start.ts         race start, the start countdown (departing → racing), resume effects
    race/clueBox.ts       clue box interaction: target and presence rules, Route Info step advance
    clue.ts               clue text, a team's target stop, clue box position, sidebar rows (pure)
    race/advantages.ts    U-Turn, Express Pass, Speed Bump
    race/rules.ts         separation, boundary, glide penalty (pure decisions)
    hud.ts                racer HUD: compass bar, distance, task line, trail points (G9); a pure query, no Action
    clock.ts              race clock, timers keyed to clock ticks
  mc/
    loop.ts               single runInterval(1): advance clock, run periodic systems by modulo
    store.ts              world dynamic properties as the core's PropertyBag
    items.ts              Race Control / Passport create, find, give, take
    wiring.ts             event subscriptions: item use (air + block fallback), spawn, /scriptevent
    world.ts              effect executor, block/entity helpers, safe chunk access
    race.ts               race start writes (rules, kit, teleport), movement lock, titles, chat, sidebar, clue-box click
    online.ts             the online player behind an id
    terrainProbe.ts       `AreaLoader` over the `race_scan` ticking area: load, read columns, scan entities and blocks
    generationJob.ts      runs the job for a `generateCourse` effect, action-bar progress, reports the outcome
    blockWorld.ts         a Dimension as the core's `BlockWorld` (heights, fill, set, topmost)
    builder.ts            builds arenas one at a time (`race_build` ticking area, a `runJob` per arena)
    lighting.ts           applies lit/unlit changes through the retry queue; the loop retries every 40 ticks
    protect.ts            break/place cancellation, mob sweep, item sweep
    ui/host.ts, ui/course.ts, ui/racer.ts, ui/forms.ts (UserBusy retry, phase-aware menus)
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
  task?: TaskSpec; pinned?: boolean; built: boolean; lit: boolean; }
type TaskSpec = { type: "detour"; options: [DetourOption, DetourOption] }   // names + kinds
  | { type: "roadblock"; kind: RoadblockKind };
interface Team { id: string; name: string; color: string; members: string[]; status: "racing"|"checkedIn"|"eliminated";
  leg: number; step: number;              // index into the leg's stops
  penaltyOwed: number;                     // clock ticks
  checkIns: { leg: number; clock: number; place: number }[];
  roadblockCounts: Record<string, number>; performer?: string;
  expressPass?: { expiresLeg: number }; uTurnUsed: boolean; uTurnedAt?: number;
  speedBump: boolean; progress: Record<string, TaskProgress>; // key: `${stopId}:${option}`
  departAt?: number; lastClearedStop: number; lockoutUntil?: number; }
```

Older saves are filled in from `createState` one level deep (top-level fields and records like `settings`, `leg`). Fields added later to array or map elements (`Team`, `Stop`, `PlayerRecord`) must be optional or read with `??`.

Transient (not persisted): open forms, separation timers, HUD caches, retry queues — all rebuildable from State.

### 2.4 Runtime loop and timing

- One `system.runInterval(fn, 1)`. While `phase === "running"` and the day is open, `state.clock++`. All timers compare against `clock`, never `system.currentTick`, so pause and multi-day are free.
- Periodic systems run by modulo: HUD 5 · parkour standing check 10 · trail 20 · last-in-bounds/boundary 40 · lighting retry 40 · save 100 · mob sweep 100 · elytra/pearl sweep 200 · separation 20.
- 1 race hour = 600 ticks (30 s); `config.ts` holds `HOUR = 600`.

### 2.5 Event handling rules

- Subscribe at module top level in `main.ts`; handlers return immediately if `state` is not yet loaded.
- `beforeEvents` handlers only decide `cancel` from in-memory state, then `system.run(() => dispatch(...))`.
- A reducer reports each outcome as a `logs` line in its `Result` (`teamsAssigned`, `playersSwapped`, `settingsSaved`, …); `Session.dispatch` writes them with the race clock. Refusals are logged by the session from their code.
- `Session.dispatch` saves at once after any accepted action (spec: "immediately after any state change"); clock-only changes are saved every 100 ticks, and a failed save is logged once and retried on that period.
- All world reads that can hit unloaded chunks go through `safe(fn)` which catches `LocationInUnloadedChunkError` / `undefined` and returns `undefined`.

### 2.6 Course generation pipeline

1. `course/skeleton.ts` (pure) produces the **skeleton**: ordered stop types per leg, pinned waypoint slots, task kinds, blind flags, Recall on final leg, hunt excluded on Peaceful.
2. `course/walk.ts` is a generator, `generateCourse(input)`: it **yields** each candidate position and takes back a `Probe` (`{pos, terrain, spread, landmark?}`, or `undefined` when rejected). G6's job (`course/job.ts`, run by `mc/generationJob.ts`) drives it across ticks: for each candidate `course/scan.ts` asks `mc/terrainProbe.ts` to load the area (the `race_scan` ticking area), `terrain.ts` (pure) accepts/rejects and classifies, and an arena moved next to a landmark comes back as a different `pos`. Tests drive the same generator with `planCourse(input, probe)`. Between long searches it also yields `PAUSE` (wait a tick, then call `next()` again): each step's work is bounded by a count (`COURSE.workPerPause`), not by time, so courses stay reproducible; G6's in-game check should confirm no tick overruns on the slower in-game interpreter. The start line and pins never move: their probe supplies only height, terrain and landmark. It returns `{ok: true, stops, probes, inserted}` or a failure (`noGround`/`noRoom` with the stop, or a pin problem) for the host message.
3. Candidates come from `course/layout.ts`: random heading and length within the distance rules, accepted only if a bounded depth-first search can still place the rest of the course after it (geometry only, no probes). The way that search found is kept, so when no random draw is viable the walk falls back to it; with any terrain the probe accepts, generation therefore does not dead-end.
4. Names drawn from terrain tables as stops are placed, unique per course (`course/names.ts`).
5. While the walk runs the host sees "Generating stop k/N…" on the action bar (`CourseInput.onStop`; N counts the planned stops, so inserted Route Info stops can push k past it). Arena builds (G7) start with the `buildArenas` effect that `courseGenerated` emits: one `runJob` per stop, in turn, each loaded with its own `race_build` ticking area (the generator's `race_scan` is never touched).
6. Generation is re-runnable: the walk itself cannot resume part-way (its RNG position depends on every candidate probed, rejected ones included), so after a reload the host re-runs Generate from the start. The same seed, start, pins and terrain replay the same course; Generate from `ready` replaces the stops; built arenas are never removed (spec §4), so the builder recognises an arena already standing at a new stop's position (§3, #26).

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
- Menus are core models (`menu.ts`): a host menu entry is a `HOST_ENTRIES` row (command, label, phases) plus a handler in `mc/ui/host.ts`'s `COMMANDS`; the record type makes a missing handler a type error. Sub-screens follow the same shape: the Teams screen is `teamsMenu` with `TeamsCommand` handled by `TEAMS_COMMANDS`.
- Host-only actions gate through `refuseUnlessHost(state, by, phases)` (codes `notHost`, `badPhase`); each handler module exports the phases it allows (`SETTINGS_PHASES`, `TEAM_PHASES`) and the menu reuses them. `Session.dispatch` returns whether the action was accepted, so a form reopens its screen only after a change.
- One form per player at a time; a second request while one is open or retrying is ignored. A closed form logs `formClosed` with its reason.
- Modal form controls are core models too (`setupFields`), and values are read back by core (`settingsFromValues`); text-only rows (labels) are skipped, whether or not the game gives them a value slot.
- After a change, the screen that made it opens again so the host sees the result (Setup → host menu with the plan, Auto-assign/Swap → Teams).

### 2.9 Testing strategy

| Layer | How |
|---|---|
| Pure core | `node:test` unit tests (plan math, schedule, caps, U-Turn targets, Express expiry, quiz normaliser, compass bar, chunked store round trip). |
| Full race | `test/sim/fullRace.test.ts`: fake world with flat terrain, scripted players walking to targets and completing tasks; asserts §14.3 outcomes. |
| Type safety | `npm run typecheck` against 2.0.0 typings (already in CI). |
| Identifiers | Vanilla ids live only in the `BLOCK` / `ITEM` / `ENTITY` tables in `config.ts`. `test/ids.test.ts` checks each against `@minecraft/vanilla-data` for the oldest supported game (1.21.90, installed as the `vanilla-data-min` alias) and the latest, and fails if any other `minecraft:` string appears in `config.ts`. vanilla-data has no particle list: particle ids get a hand-verified table with a source comment. |
| In-game | Checklist in `docs/ingame-test.md`, run per milestone on 1.21.90+ with 2 players. |

Tooling: `tsconfig.test.json` compiles `src/core` + `test` to `build/test`; `npm test` = clean build + `node --test` over `build/test/test/**/*.test.js` (Node ≥ 22). `npm run typecheck` checks both projects. `npm run lint` is the code-quality gate: ESLint 9 with `eslint-config-airbnb-extended` (Airbnb base + TypeScript strict, type-aware, @stylistic formatting at 100 columns; `npm run format` applies fixes) plus `eslint-plugin-minecraft-linting` on `src/` (flags `runCommand` calls that have a Script API equivalent), any warning fails. Project deviations from Airbnb live in `eslint.config.mjs`, each with its reason. `npm run coverage` runs the tests under c8, source-mapped to `src/core/*.ts`, and fails below 80% line coverage, counting untested core files. CI runs typecheck, lint, coverage and package in the required `build` check; GitHub Code Quality and its coverage upload aren't available for this personal repository.

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
| World reopened while the race was running | Loaded as `paused` (logged `pausedOnLoad`); a way to resume it (and to release a movement lock left by a countdown) arrives with G17, so until then a reopened race stays paused. |
| Chunk size unit (§13) | Chunks are at most 30,000 UTF-8 bytes, which also meets "30,000 characters" and the 32,767 limit however the game counts. |
| Unreadable save | Logged `loadFailed reason=…`; the stored chunks are never overwritten and the add-on stays idle (later actions log `droppedNoState` once). G3's host menu must show "Saved race unreadable — see Content Log" when the session has no state. |
| Save interrupted part-way | Chunks can briefly mix old and new text; the in-memory state is kept and the 5 s retry rewrites every chunk. Only closing the world inside that window loses the save (`badJson` on load). |
| Where the host id is stored (§3) | Inside the chunked state as `hostId`, not in its own dynamic property; it persists the same way. |
| "Saved immediately after any state change" | Every accepted action is saved at once; race clock ticks alone are saved every 5 s. |
| `itemUse` vs. block-use fallback (§3) | Both paths are wired until the in-game check settles it: `itemUse` (air) and `playerInteractWithBlock` holding a menu item (default interaction cancelled). Uses within 5 ticks count once, so a game that fires both opens one menu. |
| Old Race Control after a host change | Removed from the previous host if online; an offline copy, or one in the offhand (only the inventory container is searched), stays but is inert, because Race Control opens the menu only for the stored host. The new host's stale copies are removed before a fresh one is given. |
| "Any plain vanilla Clock" (§3) | A clock with no custom name and no lore. A non-host sneak-using Race Control with no host stored also claims. |
| Becoming host on spawn | Any spawn (join or respawn) while no host is stored claims the role; with an unreadable save nobody becomes host. Players already online when the state loads (spawned before `worldLoad`, or a script reload) are treated as joining then. |
| Unreadable save and clock gestures | With no state, Race Control and sneak-using any plain clock open the host menu for anyone, to show "Saved race unreadable"; there is no stored host to check against. |
| When the plan is fixed (§4, §8.6) | Before the race it is derived on demand from the settings and current team count (host menu shows it in Setup, Generating and Ready). Until teams exist the summary says "eliminations set by teams" instead of a count. Race start (G8) stores it in `state.plan`; teams can't change after that, so the elimination schedule is the one calculated at race start. |
| When settings and teams can change | Setup only in `setup` (settings shape legs and radius, so the course). Teams in `setup`, `generating` and `ready`; once the race runs, changes go through Team fixes. Changing settings never reshuffles teams; if team size or "Host also races" changed while teams exist, the host is told (`teamsStale`) to re-run Auto-assign. |
| Team count and sizes (§4) | ceil(racers ÷ size) teams, sizes differing by at most 1, never above the chosen size; so a team can be smaller (5 at size 2 → 2, 2, 1). Fewer than 2 teams, or more than the 12 colours, is refused. |
| Who auto-assign uses | Every online player, minus the host unless "Host also races"; earlier teams are replaced and offline members drop out. The shuffle seed is logged (`teamsAssigned seed=…`). |
| Swap two players | Two members of different teams trade places; a team member and an online unassigned racer also swap, which lets late joiners in. |
| Team ids and names | Id is the lower-case colour name (`red`), used as the `team=` log key; name and colour come from `TEAM_COLORS` in order. |
| View teams | The Teams screen's body is the view (each team in its colour, then racers on no team, then the 2-team warning); its buttons are Auto-assign and Swap. |
| Roadblock cap team size (§8.7) | The team's actual member count (`roadblockCapFor`), so a smaller team's members may each perform more. |
| Start line as a stop (§5) | Stop 0 on leg 0, with a generated name like any stop; a Pit Stop is the last stop of its leg, so "the stop a leg started from" is always the previous leg's last stop. |
| Blind segment (§5) | The segment into each Detour from leg 2 on, including the final leg's (Roadblock → Detour), so every leg from 2 has exactly one. |
| Peaceful and Detour pairs (§7.3) | Pairs with a hunt option (Fight/Find, Brains/Brawn) are left out, not half-replaced. |
| Where pins go (§6.4) | In nearest-neighbour order, spread evenly over the Detour and Roadblock stops (pin i of k takes the middle of the i-th k-th). Refused before probing (`pinOutsideCourse` beyond R, `pinTooClose` within 300 of the start line or an earlier pin, `tooManyPins` beyond the 2 per leg). A pin the probe rejects is kept where the host put it, with the fallback terrain; the segment into a pin may be under 600. |
| Extra Route Info stops (§6.4) | Only when a pin is "forced" (farther from the start line or previous pin than the stops in between can cover); then also before the Finish if the last pin leaves it out of reach. Unpinned courses always have 4 × L + 1 stops. |
| Finish room (§5) | Every stop but the Finish and pins stays at least 700 blocks (400 + 300) from the start line, so the Finish's 300–400 circle is never blocked; no Pit Stop is ever near home. Pins 300–700 from the start can block part of the circle; enough of them (four on a ring 350 blocks out) leave the Finish no room (`noRoom`), reported to the host after generation starts. |
| Candidate choice (§6.2) | Up to 6 probed per stop, stopping at the first valid one with a landmark or once 3 are valid (the flattest wins, the earliest on a tie). A candidate moved next to a landmark is re-checked against the rules. 6 rejections end generation with `noGround` for that stop. |
| Landmark pins are late-checked (§6.4) | `addPin` only checks host and phase (`setup`). The refusals (`pinOutsideCourse`, `pinTooClose`, `tooManyPins`) depend on the start line (the host's position at Generate) and the legs, so they come back through `courseFailed` with a host message naming the landmark. `noRoom` (landmarks ringed around the start) is reported the same way. Landmarks can be cleared (Setup phase), never edited one by one. |
| Generation messages and stale jobs | `startGeneration` (host; `setup` or `ready`) sets phase `generating`, `state.job += 1` and emits `generateCourse`. `courseGenerated` / `courseFailed` are system actions that carry the job id and are refused (`staleJob`) unless the phase is `generating` and the id is the newest. A world that closes mid-generation reloads in `generating` with no job running, so load moves it to `setup` (`ready` if an earlier course exists) and logs `generationAbandonedOnLoad`. |
| Failed or re-run generation | The old course stays until a new one arrives. A failed first run returns to `setup`; a failed re-run returns to `ready` with the old stops. |
| Settings after a course exists (#23) | The host can **Discard course** in `ready` (confirmation): stops and start are removed and the phase returns to `setup`; landmarks, teams and the seed are kept. Settings can then change again. Discard is not offered once the race has started. |
| Re-running generation (#26, #32) | Generate from `ready` runs the walk again from the new start line and replaces `stops`. The same seed, start, pins and terrain replay the same course, except that a probe over an old arena reads its clue box or beam glass as the ground (up to 2 blocks above the floor), so terrain and height can drift. Already built arenas stay in the world (spec §4), so the course may leave unused arenas behind. Before building, the builder looks for an arena at the stop (`looksBuilt`: iron under the centre, clue box above it, floor at a corner, searched at y, y−1, y−2); if found it is not rebuilt, `stop.pos.y` is corrected to the floor, and its lights are set to the stop's wish. |
| Arena build order and signature (§6.5) | Operations run in spec order and end with the iron base and the clue box, so a build cut short (failure, world closed) never reads as an arena. Block kinds: floor smooth stone; flags are oak fence g+1..g+3, red wool g+4, yellow wool g+5, lantern g+6 (the spec does not say how the wools and lanterns sit; this is our reading); torches at g+1, 20 of them (offsets −8, −4, 0, 4, 8 on each side; the corners hold flags); the unlit clue box is yellow concrete, the lit one a beacon under tinted glass at g+2. Fills are clamped to the dimension's height range; the column clear above g+14 reaches the topmost block. |
| Task zones (§6.5) | Data only (`zonesFor`): A is centred 6 blocks west of the stop, B 6 east. Detour has A and B, Roadblock A only; Start, Route Info, Pit Stop and Finish have none (the spec gives zones to the task stops; Route Info has no task). Later task groups read them; nothing is built for a zone. |
| When and how arenas are built | Automatically when the course is ready (before the race, spec §4/§6.1), one at a time, each in a `runJob` after its area has loaded (timeout 30 s). The host sees "Building arena k/N…". A failure (timeout, no free ticking area, error) leaves the stop unbuilt and tells the host; **Build arenas** (host, `ready`, only while some are unbuilt) tries the missing ones again. After a reload in `ready` the missing builds restart by themselves. Results carry the generation `job`; a result for an older course, or after Discard, is refused (`staleJob`). The builder checks `buildStep` (core) before each arena, again after the area loads and between operations, so a course that changed meanwhile stops it from writing; an arena that already stands is skipped, a newer request replaces one not yet started, and a lit wish for a stop that moved or vanished is dropped from the lighting queue. A reused arena (`looksBuilt`) gets the mat added if a re-run turned its place into a Pit Stop or Finish (`reuseOps`); its other features do not depend on the stop type. Race start refuses while `allArenasBuilt` is false (`arenasMissing`). |
| Lighting (§6.6) | `stop.lit` is the wish; the world follows. `setLit` sets it and asks the adapter to light the built stops among them; a built arena always gets its wish applied after building, so an old lit arena found at a new stop converges. The adapter keeps the latest wish per stop in memory and retries every 2 s (40 ticks) until the chunk reads and the blocks can be set (an unloaded chunk reads `undefined` or throws, both mean "wait"). Because the queue is memory only, loading the world re-requests every built stop's light in `ready`, `running`, `paused` and `dayEnded`. Race start resets every stop's `lit` (clearing what the debug command left) and lights leg 1 only; later legs are lit by their leg start (G10). The debug command `/scriptevent race:light <stop id\|all> <on\|off>` (host only, `ready`) lets the host check a beacon. |
| Race start (spec §8.1) | `startRace` (host, `ready`) is refused unless every arena stands (`arenasMissing`) and there are two teams; `setPhase` cannot go `ready → running` around it. It stores `plan` and the gamerule/time `snapshot` once (restoring them is G17's end-of-race work), sets `day` 1, resets every stop's `lit` and lights leg 1, then every team is on leg 1, step 0, `lastClearedStop` = the start stop. Racers are the team members online; those offline get no kit (a rejoin is G17). The kit effect clears inventory and armour, gives `KIT`, sets Survival, colours the name tag and teleports to a ring (radius 3, wider for many racers) around the start stop; the Passport and, for a host who races, Race Control (the clear removes it) follow as `giveItem`. The spec's step 1 (daylight off → time fixed at 6000) and step 2 (time 1000) contradict each other; we set 1000 and let the day run when the cycle is on, and 6000 held when it is off. There is no start-line platform: racers stand on the start arena's floor. |
| Start countdown | Held per team in `departAt` (race clock) with `leg.phase = 'departing'`, not a phase or a frozen clock: it is the same mechanism G10's staggered departures and G17's resume countdown need, and pause freezes it for free. `tick` releases when the clock reaches it (GO title, movement unlocked). A reload leaves the race `paused` and re-locks movement while `departing`. Whether movement permission survives a relog is an in-game check. |
| Clue box interaction (spec §8.2) | The adapter decides `cancel` from memory with `clueBoxAt` (a built stop's clue box, race running), then dispatches `interactClue` with the team's online members and their positions (none for another dimension). Order of checks: race under way, then the box is the team's current target (a player without a team, or a team not `racing`, gets "Not your clue box"), then the stop type is playable, then every listed member is within 10 blocks (3D, to the box centre). Route Info needs no form: it advances `step`, sets `lastClearedStop`, and the next clue appears as title + chat. Detour, Roadblock and Pit Stop say they come later and do not advance (G10/G11 own them). A clue box click by a player on a team beats the Passport/Race Control block-use fallback in one handler, so one screen opens; a host on no team still gets the host menu there. The Pit Stop clue follows the spec's example wording and has no "Leg n" prefix. The Speed Bump quiz goes before the advance (G15). |
| Racer HUD (spec §9.1) | `hudFrames(state, views, {trail})` in `core/hud.ts` is a pure query, not an Action: it changes nothing, so it skips the dispatch, save and phase logging. `mc/loop.ts` runs it every 5 ticks (trail on every 4th) and `mc/hud.ts` only displays the frames (action bar; `Player.spawnParticle`, so only that player sees them). Nothing is stored. Bar: 21 cells between brackets (the spec says 21 but its example has 20), `\|` is the heading, `O` the target, linear over ±90° (≈9° a cell); beyond 90° it reads `<< TURN AROUND >>`. Distance is horizontal metres to the clue box. A blind stop shows `Label: X n, Z n` (ASCII) with no bar, distance or trail. The action bar is one slot: line 1 navigation, line 2 the task line (penalty owed, lockout, departure countdown, in real seconds; task progress joins in G10–G12). Shown to every online member of a team that is not eliminated while the race runs (including the grace period); outside the Overworld it reads "Return to the Overworld" and nothing else (the spec is silent; the course is not in that dimension, so no task line or coordinates). Text is ASCII per the spec, so a blind stop's negative coordinates use "-" while clues use the Unicode minus (pre-existing). The trail: 3 `villager_happy` points at 2, 3.5 and 5 blocks towards the target, 0.4 below the eye. Constants and the particle id live in `config.ts` (`HUD`, `PARTICLE`). |
| Sidebar and chat (spec §10) | Objective `race`; one fake-player entry per team, named `§<colour>Team§r` (`[OUT] ` prefix for the eliminated); score = stops cleared (all stops of earlier legs plus the current step; the start line does not count). The sidebar is replaced as a whole on every change and re-sent on load. Chat announces the race start and each leg start; placements and the rest come with G10. |
| Arena protection footprint (§7.4) | Not built here. `footprint(pos)` in `arena/layout.ts` gives the 19 × 19 square for G16. |
| Who can list stops | The host, in `ready` only (the list spoils the course once racing starts); each line is leg, stop type, place name (and landmark) and coordinates. |
| What the ticking area loads (§6.1, §6.3) | The `race_scan` circle (radius 2 chunks) loads about 32 blocks around a candidate, so the landmark scan covers entities within 48 blocks but landmark blocks only inside the loaded 64 × 24 × 64 volume. An arena offset spot (20–30 blocks from a landmark) can lie outside it, so each spot is loaded in turn (up to 4) and checked with the §6.2 rules; if none passes, the candidate keeps its own position without the landmark. |
| Ticking-area failure (§6.1, §6.5) | `runCommand` reports only success or failure. A failed `tickingarea add` is treated as "the world is full" (host told to remove one) and ends the job; a failed `remove` is ignored. The area is removed before each load and when the job ends. |
| Landmark kinds | `village` (villager, `villager_v2`, iron golem or a bell), `outpost`, `desert temple`, `ruined portal`, tested in the spec's order: a village beats an outpost beats a temple beats a portal. |
| Diagnosis | `/scriptevent race:dump` logs a `stateDump` summary and the state JSON as `stateDumpPart` lines (read-only). |

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
