# In-game test checklist

Run on Bedrock 1.21.90 or newer with at least 2 players, in a copy of a world. Groups marked ✱ in
the technical design (§4) add their checks here and record the result in their PR.

## Setup

1. `npm run package`, then open `dist/AmazingRace.mcaddon` (or copy `AmazingRace_BP/` into
   `development_behavior_packs/` for quick iteration).
2. Create a world copy, activate the **Amazing Race** behavior pack. No experiments are needed.
3. Open **Settings → Creator** and enable the Content Log so script errors are visible.

## Verify first (spec §3, §14; technical design §1)

| Check | Result (version, date) |
|---|---|
| `itemUse` fires when right-clicking a Clock in the air | |
| `itemUse` fires when right-clicking a Compass in the air | |
| Beacon beam shows through the cleared column on a built arena | |
| `projectileHitBlock` reports the player as source for player-shot arrows | |
| Team-coloured `nameTag` is visible to other players | |
| Ticking-area load latency stays within the 30 s generation timeout | |

## Per milestone

### M1 — walking skeleton (G1–G8)

- [ ] Pack loads with no Content Log errors; `[race] loaded … version=<pkg> schema=1 source=new` appears.
- [ ] Reopening the world logs `source=saved` with the same `seed` (state persisted).
- [ ] Closing the world while the race runs, then reopening it, logs `pausedOnLoad`.
- [ ] Forms open (host menu, Passport).
- [ ] First player to join a fresh world gets Race Control and `hostChanged … via=playerSpawned` is logged.
- [ ] Race Control opens the host menu (in the air and on a block; one menu, block not opened);
      it shows `Phase: Setup` with **Setup**, **Teams** and **Transfer host**.
- [ ] A non-host using Race Control is told who the host is; sneak-using a plain clock is refused.
- [ ] Host sneak-uses a plain clock: the old Race Control is replaced by a fresh one.
- [ ] Transfer host to the second player: the item moves, both get a message.
- [ ] `/scriptevent race:host` makes the sender host; `/scriptevent race:dump` logs `stateDump`.
- [ ] Race Control is kept on death and cannot be dropped.
- [ ] Opening the host menu with chat open shows it once chat closes (UserBusy retry).
- [ ] With a corrupted save (`race:n` set to a bad value), Race Control shows
      "Saved race unreadable — see Content Log".
- [ ] Setup (only in Setup phase) shows the copy-world reminder, the five controls with current
      values, and minutes step by 15; saving reopens the host menu with
      e.g. `6 legs · ~1,800-block radius · …` and logs `settingsSaved`.
- [ ] ✱ Setup values land in the right settings (the reminder label must not shift the slider
      and toggle values); closing a form without saving logs `formClosed`.
- [ ] Teams → Auto-assign with 3+ online racers: each racer is told their team and teammates,
      the screen shows the coloured teams, and `teamsAssigned … seed=…` is logged.
- [ ] Teams → Swap two players moves them (and lets an unassigned player in); with only one
      team possible, Auto-assign is refused and explained.
- [ ] HUD direction matches facing.

### G6 — course generation ✱

- [ ] ✱ Host menu in Setup shows **Add landmark here**, **Clear landmarks** and **Generate course here**;
      in Ready it shows **Generate course here**, **List stops** and **Discard course**.
- [ ] ✱ `/tickingarea add circle … race_scan true` works from script without cheats enabled
      (no "Commands are disabled"); if it fails, Generate says to remove a ticking area.
- [ ] ✱ With 10 ticking areas in the world, Generate stops with the "remove one" message and
      the phase returns to Setup.
- [ ] ✱ Generate on a 2-leg course: the action bar counts "Generating stop k/N…", no stop takes
      longer than 30 s to load, and `race_scan` is gone afterwards (`/tickingarea list`).
- [ ] ✱ A 6-leg course finishes in about 2–4 minutes and logs `generationFinished` with its
      ticks; the game does not stutter between probes (#25: no tick overruns on the in-game
      interpreter; if `[Scripting] watchdog` appears, lower `COURSE.workPerPause`).
- [ ] ✱ List stops shows each stop's leg, type, place name and coordinates; the first stop is
      the host's start position; walking to two stops confirms 600–900 blocks between them.
- [ ] ✱ #25: a 12-leg course with several landmarks generates with no `[Scripting] watchdog`
      warning, also with one candidate in a badlands biome (landmark block scan stays cheap).
- [ ] ✱ A real village is detected with and without a bell loaded (villagers may report
      `villager_v2`; if not tagged, check the entity type id in the log).
- [ ] ✱ A stop near a swamp pond or desert cactus is never placed on water; after a world is
      closed mid-generation, `tickingarea list` may show `race_scan` until the next Generate.
- [ ] ✱ Stops near a village or an outpost are tagged with it and sit 20–30 blocks from it, on
      flat ground, not on the structure.
- [ ] ✱ Add landmark here at a spot 800+ blocks from the start line, then Generate: the course
      includes a stop at the landmark's coordinates.
- [ ] ✱ A landmark too close to the start line is refused after generation starts with a
      message naming "Landmark 1"; the phase returns to Setup.
- [ ] ✱ Closing the world during generation and reopening it: `generationAbandonedOnLoad` is
      logged and the host menu is back in Setup.
- [ ] ✱ Generate again from Ready replaces the course; Discard course returns to Setup and
      Setup can be opened again, with landmarks and teams still there.

### G7 — arena build & lighting ✱

- [ ] ✱ After Generate finishes, the host sees "Building arena k/N…" and then "All arenas are
      built." A 6-leg course needs no input; `arenaBuilt` is logged per stop and `race_build` is
      gone from `/tickingarea list` afterwards.
- [ ] ✱ At a stop (fly there): a 19 × 19 smooth-stone floor, a 3 × 3 iron base with a yellow
      concrete block above its centre, four flags (fence, red wool, yellow wool, lantern), 20
      torches along the edge; nothing else stands within 14 blocks above the floor, and the
      column above the centre is clear of trees or overhangs.
- [ ] ✱ Pit Stop and Finish have the red and yellow checker mat 6 blocks south of the centre;
      other stops do not.
- [ ] ✱ Dirt fills holes and water below the floor, and no water is left inside the cleared box
      (a stop beside a pond: note whether water flows in afterwards; the spec does not seal edges).
- [ ] ✱ `/scriptevent race:light 1 on` turns that stop's clue box into a beacon with a beam and
      tinted glass above it (yellow Route Info / Detour, red Roadblock, lime Pit Stop / Finish,
      white Start); `off` restores yellow concrete and removes the glass; `all on` works.
- [ ] ✱ Lighting a stop in an unloaded chunk (fly away first): `lightsDeferred` is logged, and
      the beacon appears within a few seconds of flying back, with `lightsApplied tries=n`.
- [ ] ✱ Close and reopen the world with stops lit: the lit stops show beacons again after load.
- [ ] ✱ Close the world while arenas are building: after reopening, the missing ones build by
      themselves; **Build arenas** appears in the host menu only while some are missing.
- [ ] ✱ #32: Generate again from the same start (or after Discard): arenas that already stand are
      not rebuilt or stacked 1–2 blocks higher (`arenaBuilt existing=true`), and old lit ones
      follow their stop's lit state.
- [ ] ✱ Observation for #34 (not fixed here): note any arena standing on a village roof or other
      structure while flying the course.
- [ ] ✱ At night with torches only: no hostile mob spawns on the arena floor, including its middle.
- [ ] ✱ With 10 ticking areas in the world, the build stops and tells the host to remove one;
      Build arenas works afterwards.

### G8 — race start & core loop ✱

- [ ] ✱ With an arena missing, **Start race** is refused and says how many; once all stand, the
      host confirms ("inventories will be cleared") and the race starts.
- [ ] ✱ At start: racers are in Survival with the stone tools, 16 bread and a Passport (nothing
      else), name tags in their team colour, and stand on a ring around the start arena; the host
      who races still has Race Control. Gamerules `keepInventory` and `showCoordinates` are on.
- [ ] ✱ Time: with the day-night cycle on it is morning and moves; off, it stays at noon.
- [ ] ✱ Movement is locked for 10 seconds (cannot walk, jump or sneak), then "GO!" shows and
      movement is free. Close the world during the countdown, reopen: note whether movement is
      still locked (the add-on re-locks it on load; releasing it after a pause comes with G17).
- [ ] ✱ Only leg 1's beams are lit, even after `race:light all on` before the start (#36).
- [ ] ✱ Each racer gets the Leg 1 Route Info clue as a title and in chat; chat shows the race
      start and "Leg 1 begins."; the sidebar lists each team coloured with score 0.
- [ ] ✱ Clue box (hold the Passport and click it): exactly one screen/message, no block UI. A
      teammate 11+ blocks away, or in the Nether, gives "All teammates must be present"; with
      everyone within 10 blocks the clue advances, shows the next stop's clue and the team's
      sidebar score rises by one. Another team's box gives "Not your clue box".
- [ ] ✱ Sidebar fake-player names keep their colour codes.
- [ ] ✱ Detour / Roadblock / Pit Stop boxes say they come in a later update.

### M2–M4

Add checks as the groups land.
