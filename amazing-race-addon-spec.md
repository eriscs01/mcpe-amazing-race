# Minecraft Bedrock "Amazing Race" Add-on — Design Specification

Status: approved design, ready for implementation. Planning date: 2 Nov 2026.
Audience: a Claude Code session implementing the add-on. Follow this document exactly; anything marked **[Verify first]** must be tested before building on it.

---

## 1. Goals and constraints

- Translate the core loop of *The Amazing Race* into a Bedrock add-on: **receive clue → travel → complete task → repeat → check in at Pit Stop → placement / elimination → next leg**.
- Played by **more than 6 players** in teams, run by **one host** who should rarely need to intervene. Every challenge is verified automatically by script.
- Played over **multiple real-life sessions** (default: 3 days × 60 minutes).
- Simple code, **stable APIs only** — no Beta APIs, no experimental toggles.
- **Vanilla resources only** — no resource pack, no custom items, blocks, entities, textures, recipes or sounds.
- No chat commands needed by the host; everything runs through forms opened with a vanilla item.

Out of scope (deliberately cut from the show): money/cash allowance, transport purchases, Yield, Fast Forward, equalizers/hours of operation, luggage, bartering, Marked for Elimination, Double/Vote U-Turn, underground landmarks (ancient city, stronghold, dungeon, mineshaft), and restoring terrain after the race.

**World policy:** the race is played in a **dedicated world** that is reset afterwards, not in a world people keep playing. The host makes a copy before Day 1 (Bedrock world settings → **Copy World**, or a backup on Realms or a server) and restores or deletes the race world when finished. The add-on does not save or restore any terrain.

---

## 2. Technical foundation (verified)

- Latest stable modules at planning time: `@minecraft/server` 2.11.0 and `@minecraft/server-ui` 2.3.0 (Bedrock 26.60, released 27 Oct 2026).
- **Target `@minecraft/server` 2.0.0 and `@minecraft/server-ui` 2.0.0** for the widest compatibility (game 1.21.90 and newer). Type-check against the npm typings for exactly these versions.
- APIs confirmed present in the 2.0.0 typings: `Dimension.getTopmostBlock`, `Dimension.getBlocks(volume, filter)`, `Dimension.getEntities`, `Dimension.runCommand` (returns `CommandResult` with `successCount` only), `system.waitTicks`, `system.runInterval`, `world.afterEvents.worldLoad`, `world.beforeEvents.playerInteractWithBlock`, `world.beforeEvents.playerBreakBlock`, `world.afterEvents.playerBreakBlock`, `world.afterEvents.playerPlaceBlock`, `world.afterEvents.projectileHitBlock`, `world.afterEvents.entityDie`, `world.afterEvents.playerSpawn`, `world.afterEvents.itemUse`, `system.afterEvents.scriptEventReceive`, `Player.inputPermissions.setPermissionCategory`, `Player.spawnParticle`, `ItemLockMode`, `GameMode`, world dynamic properties, `world.scoreboard.setObjectiveAtDisplaySlot`.
- Server-UI 2.0 signatures: `ModalFormData.textField(label, placeholder, options?)`, `dropdown(label, items, options?)`, `slider(label, min, max, options?)`, `toggle(label, options?)`.
- Script API 2.0 rule: **no world access at module top level**. Subscribe to events at top level, but initialise state inside `world.afterEvents.worldLoad`.
- Because `runCommand` returns only a success count, `/locate` output **cannot** be read. There is no stable structure-finding API. Landmarks are detected by scanning (section 6.3).

### Package layout

- One **behavior pack only**. Manifest `format_version` 2. `min_engine_version` [1, 21, 90]. One `data` module and one `script` module (`language: javascript`, entry `scripts/main.js`). Dependencies: `@minecraft/server` "2.0.0", `@minecraft/server-ui` "2.0.0". No resource pack dependency.
- Deliver as a `.mcaddon` (zip containing the behavior pack folder). A `pack_icon.png` is optional; if included it must be a vanilla-style placeholder generated locally, not downloaded art.
- Suggested script modules: `main` (event wiring, tick loop), `config` (constants, tables), `state` (model, persistence, race clock), `course` (generation, landmark scan, arena build), `tasks` (challenge setup and verification), `race` (leg flow, pit stops, penalties, advantages), `hud` (guidance, boundary, separation, sidebar), `ui` (host and racer forms), `util`. Target size is roughly 1,500 lines.

---

## 3. Items (vanilla, script-tagged)

| Role | Vanilla item | Name tag | Lore | Properties |
|---|---|---|---|---|
| Host menu | `minecraft:clock` | `§6Race Control` | `Amazing Race host menu` | keepOnDeath true, lockMode inventory |
| Racer menu | `minecraft:compass` | `§eRace Passport` | `Amazing Race passport` | keepOnDeath true, lockMode inventory |

- Items are recognised by **type + name tag + lore**, and the host item also requires the user to be the stored host.
- **Becoming host:** the first player to spawn when no host is stored becomes host automatically and receives Race Control. Host id is stored in a world dynamic property.
- **Replacement:** the current host sneaks and uses any plain vanilla Clock → a fresh Race Control is issued. If no host is stored, sneak-using any Clock claims the host role.
- Backup for operators: `/scriptevent race:host` makes the sender host and gives the item. Optional, never required.
- Passports are given automatically to every racer at race start and on rejoin if missing.
- **[Verify first]** that `itemUse` fires when right-clicking a Clock and a Compass in the air. If it does not, open menus from the block-interact event instead (`playerInteractWithBlock` carries the held `itemStack`): using the item on any block opens the menu and the default interaction is cancelled.

---

## 4. Host setup (UI only)

The host menu is an ActionForm that shows only buttons valid for the current race phase.

### Setup screen (ModalForm)

| Option | Control | Range | Default |
|---|---|---|---|
| Days | slider | 1–5 | 3 |
| Minutes per day | slider (step 15) | 30–120 | 60 |
| Players per team | slider | 2–4 | 2 |
| Host also races | toggle | — | off |
| Day-night cycle | toggle | — | on |

After saving, the menu shows the derived plan, e.g. "6 legs · 3 eliminations · ~1,800-block radius".

### Derived automatically (not host options)

- **Legs per day** = floor(minutes per day ÷ 30), minimum 1. **Total legs** L = days × legs per day, clamped 2–12. Default: 3 × 2 = 6.
- **Course radius** R = 1,200 + 100 × L, clamped 1,400–2,400 blocks. Default (6 legs): 1,800.
- **Boundary** = R + 200 (warning) / R + 300 (hard limit).
- **Time scale:** 1 "race hour" = 30 real seconds (used only for penalties).
- **Elimination schedule** (section 8.6), penalties, rest times, task difficulty.

### Other host menu screens

- **Teams:** Auto-assign (shuffled, as even as possible around the chosen size; e.g. 10 players at size 4 → 4, 3, 3; at least 2 teams required or the screen warns), Swap two players (two dropdowns), View teams. Team names and colours come from a fixed vanilla colour list: Red §c, Blue §9, Green §a, Gold §6, Purple §5, Aqua §b, Pink §d, White §f, Gray §7, Jade §2, Teal §3, Maroon §4.
- **Course:** Add landmark here (must be done before generating), Generate course here (host's position becomes the start line), List stops (leg, stop type, place name, coordinates).
- **Session:** Start race (day 1) / Resume day, Pause / Unpause, End day.
- **Team fixes:** pick a team → Add penalty (minutes slider), Skip current step, Teleport me to team, Eliminate team.
- **Status:** per team — leg, current step, members online, penalty owed, advantages.
- **End race:** confirmation → reset gamerules and players (section 12). Terrain is not restored.
- **Transfer host:** dropdown of online players.

The Setup and Generate course screens show a reminder: "Play in a copy of your world. Use Copy World in world settings before generating. Arenas are not removed afterwards."

Starting the race shows a confirmation that **racer inventories will be cleared** before the kit is given.

---

## 5. Course structure

- Each leg has 4 stops in this order:
  - Legs 1 to L−1: **Route Info → Detour → Roadblock → Pit Stop**.
  - Final leg: **Route Info → Roadblock (Recall) → Detour → Finish**.
- Leg 1 starts at the **Start Line** (the host's position when generating). Every later leg starts at the previous leg's Pit Stop.
- Total stops = 4 × L + 1 (start). Default 25.
- **Segment length** (straight line between consecutive stops): **600–900 blocks**. Rationale: walking ≈ 4.3 blocks/s, sprinting ≈ 5.6 blocks/s, real terrain progress ≈ 3 blocks/s → ~5 minutes per segment.
- Every stop must lie within R of the start line and at least 300 blocks from all other stops. When a walk drifts past 0.6 R, bias the next heading back toward the centre.
- The Finish must be within 400 blocks of the Start Line ("returning home").
- Each stop gets a generated place name from its terrain: prefix + suffix from the terrain table (e.g. "Frostpine Ridge", "Amber Dunes"). Names must be unique within a course.
- One segment per leg from leg 2 on (Route Info → Detour) is a **blind segment**: the HUD shows only the target coordinates, no arrow or trail.

### Estimated session pacing

4 segments × ~5 min + 2 tasks × 3–5 min ≈ 30 min per leg → 2 legs per 60-minute day.

---

## 6. Course generation

### 6.1 Loading terrain

- Use exactly one ticking area named `race_scan`: remove any previous one, then add a circle at the candidate with radius 2 chunks and preload true.
- Poll every 5 ticks until the centre block is readable (treat `undefined` or an unloaded-chunk error as not ready). Wait 10 more ticks, then scan. Time out after 30 seconds and treat the candidate as rejected.
- Remove the ticking area when done. If adding it fails (the world already has 10 ticking areas), stop and tell the host to remove one.
- Run generation as an async job with `system.waitTicks`. Show progress to the host on the action bar ("Generating stop 7/25…").
- Expected total time: roughly 2–4 minutes for 25 stops. This is a one-time step before Day 1.

### 6.2 Evaluating a candidate

- Find the **ground**: start at `getTopmostBlock`, then walk down through leaves, logs, plants, snow layers and other non-ground blocks. Remember if leaves or logs were passed (marks forest).
- Sample ground height at the centre and at ±6 blocks on each axis (5 samples).
- **Reject** if the centre is water or lava, or if the height spread across samples is more than 6 blocks.
- **Classify terrain** from the ground block and markers:
  - desert: sand, red sand, sandstone, terracotta
  - snowy: snow, snow layer, ice, packed ice, powder snow
  - forest: leaves or logs passed, podzol
  - plains: grass block, mycelium
  - mountain: stone, gravel, andesite, diorite, granite, deepslate, tuff, calcite
  - swamp: mud, mangrove roots
  - fallback: plains
- Up to 6 candidates per stop. Pick the first candidate with a landmark (6.3); otherwise the flattest of the first 3 valid ones.
- Each candidate's heading is random. Distance is random within 600–900 from the previous stop. All rules from section 5 apply.

### 6.3 Landmark detection (surface only)

While a candidate is loaded, check within 48 blocks horizontally:

| Landmark | Signal |
|---|---|
| Village | villager or iron golem entities, or a `bell` block |
| Pillager outpost | pillager entities |
| Desert temple | `chiseled_sandstone` together with `orange_terracotta` |
| Ruined portal | `crying_obsidian` |

- Use `getEntities` with a location and max distance for entities. Use `getBlocks` with an include-types filter over a bounded volume (no larger than 64 × 24 × 64 around the surface) for blocks.
- When a landmark is found, place the arena on flat ground **20–30 blocks from the landmark**, never on top of it. Re-run the 6.2 checks on the new spot.
- Tag the stop with the landmark and include it in the clue text ("Head to the village near Willow Fen").

### 6.4 Host-pinned landmarks

- "Add landmark here" stores the host's position as a mandatory waypoint.
- The generator visits pinned waypoints in nearest-neighbour order from the start line. Each becomes a Detour or Roadblock stop, never a Route Info or Pit Stop.
- If a pinned waypoint forces a segment over 900 blocks, insert an extra Route Info stop in between.

### 6.5 Arena build

Each stop gets a 19 × 19 arena centred on (x, z) at ground height g.

1. Clear the arena to air from g+1 to g+14. Fill air and water below the floor with dirt, from g−2 to g−1.
2. Lay a smooth stone floor at g.
3. Clear the single column above the beacon position up to the topmost block, so the beam can reach the sky.
4. Build the centre:
   - **Beacon base:** a 3 × 3 of iron blocks at g, centred.
   - **Clue box:** at (x, g+1, z), a beacon when lit or yellow concrete when unlit.
   - **Beam colour:** glass at g+2 — yellow for Route Info and Detour, red for Roadblock, lime for Pit Stop and Finish, white for Start.
5. **Flags:** at the 4 corners, oak fence posts 3 high topped with red wool and yellow wool, with lanterns.
6. **Lighting:** torches every 4 blocks along the floor edge, so no mobs spawn.
7. **Task zones:** zone A is the west half centred at (x−6, z); zone B is the east half centred at (x+6, z). Roadblock stops use zone A only.
8. **Pit Stop / Finish:** a 3 × 3 checker of red and yellow concrete centred at (x, g, z+6) forms the **mat**. There are no task zones.

### 6.6 Lighting beacons

- Only the current leg's stops and the stop the leg started from are lit (beacon + glass). All other stops show yellow concrete with no glass. This prevents spoiling future stops.
- Lighting changes are applied whenever the stop's chunk is loaded: retry every 2 seconds until the block can be set.

---

## 7. Challenges (all auto-verified)

### 7.1 Kinds

| Kind | Setup when the team starts it | Completion check |
|---|---|---|
| **Archery** | 6 target blocks on the zone's outer wall (x±9), at z offsets −6, −4, −1, 1, 4, 6 and heights g+2 to g+4. Give a bow and 24 arrows. | Hit 4 distinct targets (legs 1–2) or 5 (leg 3+). Use `projectileHitBlock`. The shooter must be an eligible player at least 8 blocks horizontally from the target when hit. |
| **Parkour** | White concrete jump course inside the zone, ending at a gold block. Legs 1–2: 8 jumps with 1-block gaps, rising 1 block every 2 jumps. Leg 3+: 6 jumps with 2-block gaps. | An eligible player is standing on the gold block (checked every 10 ticks). |
| **Haystack** | Hay bale pile 5 × 5 × 3 at the zone centre. Yellow wool is hidden in the middle layer's interior 3 × 3; the number hidden is the number of teams, up to 9. | An eligible player breaks a hidden wool block (`playerBreakBlock`). Each wool block counts once. If the hidden blocks run out, rebuild the pile with new wool. |
| **Hunt** | Spawn husks at the zone centre: 3 (legs 1–2) or 4 (leg 3+). Name tag each with the team colour + "Target" and tag them for the team. | Each kill by an eligible player counts (`entityDie` with `damagingEntity`). A target killed by anyone else is respawned. |
| **Gather** | None. The item list comes from the stop's terrain (table below). | At the clue box, the team's combined inventory holds the required items; they are removed on hand-in. |
| **Quiz** | Draw questions: 50% trivia, 25% arithmetic, 25% mob/item anagram. | All questions answered correctly in clue-box forms. A wrong answer locks the team out for 10 seconds. |
| **Recall** (final Roadblock only) | One dropdown per previous leg, listing all Pit Stop names shuffled. | Every leg is matched to its Pit Stop. A wrong submission locks the team out for 20 seconds. |

Quiz question counts:

| Used as | Questions |
|---|---|
| Detour | 4 |
| Roadblock | 3 |
| Speed Bump | 2 |

Quiz answers are normalised before comparison: lowercase, letters and digits only, with alias lists accepted. The trivia bank has at least 30 questions with **verified-accurate** answers.

### 7.2 Gather table by terrain

| Terrain | Required items |
|---|---|
| desert | 32 sand or red sand |
| snowy | 16 snowballs |
| forest | 16 logs (any wood type) |
| plains | 10 wheat seeds |
| mountain | 32 cobblestone or cobbled deepslate |
| swamp | 32 dirt or mud |

### 7.3 Detours and Roadblocks

- **Detour pairs** (option names A / B → kinds):
  - Aim / Climb → archery / parkour
  - Fight / Find → hunt / haystack
  - Muscle / Mind → gather / quiz
  - Dig / Shoot → haystack / archery
  - Brains / Brawn → quiz / hunt
  - Hike / Haul → parkour / gather
- Never use the same pair twice in a row.
- **Roadblock kinds:** archery, parkour, haystack, quiz, hunt. Never repeat the previous Roadblock's kind. The final leg is always Recall.
- **Roadblock hints**, shown before the performer is chosen:
  - archery: "Who has a good eye?"
  - parkour: "Who's light on their feet?"
  - haystack: "Who's ready to dig deep?"
  - quiz: "Who's the brains of this team?"
  - hunt: "Who's ready for a fight?"
  - recall: "Who's been paying attention?"
- If the world difficulty is Peaceful, the generator excludes hunt everywhere.
- **Who counts:** on a Detour, any team member; on a Roadblock, only the chosen performer; on a Speed Bump, any team member.

### 7.4 Arena protection and safety

- Inside lit arena footprints, block breaking is cancelled for racers, except `hay_block` and `yellow_wool` inside a haystack zone.
- Any block a racer places inside a footprint is removed and returned to them.
- Every 5 seconds, hostile mobs inside a footprint are removed, except husks tagged as hunt targets.

---

## 8. Race flow

### 8.1 Race start (Day 1)

1. Snapshot the original gamerules and time. Then set:
   - `keepInventory` true
   - `showCoordinates` true
   - `doDaylightCycle` on or off according to the toggle; when off, time is fixed at 6000
2. Set the time to 1000 (morning).
3. Clear racer inventories and give the kit: stone pickaxe, axe, shovel and sword, 16 bread, and the Passport. Set racers to Survival. Colour each racer's name tag with the team colour.
4. Teleport all racers to the start-line platform, spread out.
5. Lock movement for a 10-second countdown (`inputPermissions` Movement off). Show a "GO!" title, then unlock.
6. Light leg 1. Every team's first clue points to the leg 1 Route Info stop.

### 8.2 Clue box interaction

- `beforeEvents.playerInteractWithBlock` (first event only) on a stop's clue-box block: cancel the event, then open the form on the next tick.
- **Requirements:**
  - The block is the team's current target stop.
  - Every **online** team member is within 10 blocks. Exception: while a Roadblock is in progress, only the performer needs to be there.
  - Otherwise show the reason: "Not your clue box", or "All teammates must be present".
- **Route Info:** if the team has a Speed Bump, the Speed Bump quiz comes first. Otherwise the team receives the next clue and the step advances.
- **Detour:**
  1. On the first visit, show the U-Turn board if this leg has one.
  2. The team chooses option A or B; that option's setup runs.
  3. On later visits, the form shows: progress, Hand in (gather), Answer questions (quiz), Switch option (progress on each option is kept), Use Express Pass, Quit (+6 h penalty).
- **Roadblock:**
  1. The hint is shown. Any member picks the performer from the members still under their cap; first submission wins.
  2. The full task is then revealed.
  3. Later visits show: progress, Use Express Pass, Quit (+4 h penalty).
- **Completion** of any task: the next clue is shown right away as a title plus chat text, and the step advances.

### 8.3 Clue text

Every clue states the leg, the stop type, the place name, X/Z coordinates and what to look for. Examples:

- Route Info: "Leg 3 · Route Info — Make your way to Amber Dunes (X 1204, Z −388). Find the clue box under the yellow beam."
- Pit Stop: "Check in at the Pit Stop: Willow Fen. The last team to arrive may be eliminated!"
- Blind segment: the clue adds "Navigate by coordinates only."

### 8.4 Pit Stop check-in

- **Arrival:** all online members are within 2 blocks horizontally of the mat centre.
- **Penalties owed:**
  - The team is locked in place on the mat with a countdown on the action bar.
  - Check-in completes when the countdown ends. Teams arriving in the meantime are placed ahead of them.
- **Placement:** order of completed check-in.
  - The host announces it in chat: "Team Red — you are team number 1!"
  - Leg winners get 5 XP levels and a firework.
- **Final leg:** the first team to check in at the Finish wins. The race ends when every team has checked in, or 60 seconds after the winner.

### 8.5 Ending a leg

- When exactly one team has not checked in (and is not serving a penalty), it gets a **60-second grace period**. The leg ends when it checks in or the grace period expires. The host can also end the leg immediately.
- **Elimination leg:** the last team is eliminated. Its members switch to Spectator and their Passports are removed.
- **Non-elimination leg:** the last team is teleported to the Pit Stop, placed last, and receives a **Speed Bump** for the next leg.
- **Rest:** 20 seconds. Players are healed and fed through vanilla instant health and saturation effects. Unlight the finished leg and light the next one.
- **Departure:** teams leave in check-in order. Each team's start delay equals its finish gap behind the leg winner, capped at 45 seconds. Movement is locked until departure, with a countdown on the action bar.

### 8.6 Elimination schedule

- With N teams and L legs: eliminations E = max(0, N − 3), capped at L − 1. This leaves 3 teams in the final, or all teams if N ≤ 3.
- The elimination legs are the last E of legs 1 to L−1. All other legs are non-elimination (Speed Bump), so leg 1 is non-elimination whenever possible.
- The schedule is calculated at race start, when the number of teams is known.

### 8.7 Advantages and interference

- **U-Turn:**
  - Offered at Detours on legs 2 to L−1, once per team per race.
  - Valid targets: non-eliminated teams that have not yet reached this Detour (same leg, earlier step, not checked in).
  - Chat announces it when used. The target must complete **both** options of that Detour.
- **Express Pass:**
  - The leg 1 winner receives 1.
  - It skips one Detour option, a Roadblock or a Speed Bump. On a U-Turned Detour it skips only one side.
  - It expires at the end of leg ceil(L / 2) and is never usable on the final leg.
- **Speed Bump:** a 2-question quiz at the first clue box of the next leg, which must be done before taking that clue. Quitting it costs 4 h.
- **Roadblock cap:** each player may perform at most ceil(total Roadblocks ÷ team size). If every member is at the cap, allow anyone.

### 8.8 Penalties (1 race hour = 30 s)

| Situation | Penalty | Real time |
|---|---|---|
| Quit a Roadblock | 4 h | 120 s |
| Quit a Detour | 6 h | 180 s |
| Quit a Speed Bump | 4 h | 120 s |
| Teammates separated (rule 9.3) | 0.5 h | 15 s |
| Gliding with elytra | 0.5 h | 15 s |
| Host-added | host chooses | — |

Penalties build up during the leg and are served at the next Pit Stop (8.4). If the host force-ends a leg while a penalty is unserved, the remainder is added to that team's next departure delay.

---

## 9. Guidance and rules enforcement

### 9.1 HUD (private, per team)

Updated every 5 ticks on the action bar:

- **Navigation line:** a 21-character ASCII compass bar showing the target direction relative to the player's facing, then the distance in metres, then the stop label. Example: `[----------|---O-----] 412m Detour`. If the target is behind the player, show `<< TURN AROUND >>`.
  - Bedrock yaw: 0 = south (+Z), 90 = west (−X). Use ASCII only; Unicode arrows may not render.
- **Task line**, while at a stop: progress (e.g. "Aim: targets 3/5"), penalty owed, lockout timers, departure countdown.
- **Particle trail:** every 20 ticks, 3 `minecraft:villager_happy` particles at 2, 3.5 and 5 blocks toward the target, slightly below eye level. Uses `Player.spawnParticle`, so only that player sees them.
- **Blind segments:** coordinates only. No bar, no trail.

### 9.2 Boundary

- Beyond R + 200 from the start line: warning with the direction back to the course.
- Beyond R + 300, or 10 seconds past R + 200: teleport to the player's last in-bounds position, which is recorded every 2 seconds.
- Any racer outside the Overworld is teleported back to their last in-bounds position.

### 9.3 Teammates together

- If any online member is more than 24 blocks from the team's nearest member for 15 seconds in a row, add the 0.5 h penalty. Warn at 10 seconds. After a penalty, there is a 60-second cooldown before the next one.
- **Exemptions:**
  - During a Roadblock, as long as non-performers stay within 40 blocks of the stop
  - The 30 seconds after a teammate's death or rejoin
  - While movement is locked

### 9.4 Transport

- Vanilla boats and horses found in the world are allowed.
- Every 10 seconds, elytra and ender pearls are removed from racer inventories.
- Gliding (`isGliding`) earns the elytra penalty, at most once per leg.

---

## 10. Public progress display

- **Sidebar scoreboard** (vanilla), objective `race`, shown in the sidebar to everyone:
  - One entry per team name, coloured; the score is the total stops cleared.
  - Eliminated teams are prefixed with `[OUT]`.
  - Locations are never shown publicly.
- **Chat broadcasts:** race start, leg start, Pit Stop placements, U-Turn used, Express Pass used, eliminations, Speed Bump assigned, winner.
- **Private detail** (exact target, task progress) appears only on that team's HUD and Passport.

---

## 11. Multi-day sessions

- **Race clock:** an internal tick counter that runs only while the race is active, not paused, and the day is open. All timers use it. It is stored in state.
- **End of a day:**
  - After the day's planned legs finish, the addon ends the day automatically once the leg's rest begins: "Day 1 complete — see you next session".
  - The host can also end the day mid-leg.
  - On ending a day, save each racer's position, freeze the daylight cycle and save the time of day.
- **Reminder:** when the configured minutes per day have passed in-session, the host gets a reminder. Nothing ends automatically mid-leg.
- **Resume day:**
  - Restore the time of day and the daylight cycle.
  - **Day ended at a Pit Stop:** teleport each team to its Pit Stop, then run staggered departures (8.5).
  - **Day ended mid-leg:** teleport each racer to their saved position, with a 10-second movement-locked countdown.
- **Pause / Unpause:** freezes the race clock, locks racer movement and freezes the daylight cycle.

---

## 12. Deaths, disconnects, end of race

- **Death:**
  - Inventory is kept.
  - On respawn (`playerSpawn`, not the initial spawn), teleport the player to their team's last cleared stop.
  - The teammate is notified and separation checks pause for 30 seconds.
  - A Roadblock performer keeps the role and their progress.
  - There is no extra penalty.
- **Disconnect / missed day:**
  - The team continues with whoever is online; presence checks count online members only.
  - A rejoining player gets their Passport if missing and is teleported to the nearest online teammate, or to the team's last stop.
  - A team with nobody online is frozen and may hit the last-team grace period. The host can use Skip or Teleport to help.
- **End race (host):**
  1. Remove hunt husks.
  2. Restore the gamerules and time from the snapshot.
  3. Remove the sidebar objective.
  4. Set every player back to Survival, restore name tags, and remove Passports.
  5. Arenas stay in the world; the host resets the world from their copy (section 1).

---

## 13. Persistence

- **Storage:** all state lives in world dynamic properties as JSON, split into chunks of 30,000 characters or less (keys `race:s0…sN` plus a count key).
- **Saving:** every 5 seconds, and immediately after any state change.
- **State contents:**
  - **Settings and derived plan:** host id, settings, derived plan, phase
  - **Clock and world snapshot:** race clock, gamerule/time snapshot
  - **Course:** stops (id, type, leg, position, terrain, name, landmark, tasks with their parameters, built/lit flags)
  - **Teams:** id, name, colour, member ids and names, leg, step, status, penalty owed, check-in times and placements, Roadblock counts per player, Express Pass, U-Turn used/received, Speed Bump flag, per-option task progress, departure time, last cleared stop
  - **Players:** last positions
- Players are identified by `player.id`.

---

## 14. Verification expected from the implementer

1. Test the `itemUse` behaviour from section 3 first. Pick the primary or fallback menu path based on the result.
2. Type-check every script against `@minecraft/server@2.0.0` and `@minecraft/server-ui@2.0.0` typings (TypeScript `checkJs`, no emit). There must be zero errors and no Beta-only symbols.
3. Run a Node mock harness that stubs both modules and simulates a full race: 9 players, team size 3, 3 days, flat test terrain. Check the elimination schedule, Roadblock caps, U-Turn targeting, Express Pass expiry, penalty-ordered check-in, multi-day resume, and that state survives a save/load round trip.
4. Before writing any block, item, entity or particle identifier into the code, confirm it is a valid current Bedrock identifier.
5. Test in-game on 1.21.90+ with at least 2 players. Check:
   - beacon beams activate on built arenas
   - forms open
   - the HUD direction matches facing
