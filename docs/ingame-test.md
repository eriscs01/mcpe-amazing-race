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
- [ ] ✱ Start with one racer standing in the Nether: they are brought to the Overworld start
      ring, at a block centre, not stuck in rock. A Nether block at an arena's coordinates is not
      treated as its clue box.

### G9 — HUD & navigation ✱

- [ ] ✱ With 2 players: the action bar shows a 21-cell `[----------|---O-----] 412m Route Info`-style bar; turning
      moves the `O` the right way (target to your right → `O` right of the centre mark).
- [ ] ✱ Facing away from the target shows `<< TURN AROUND >>`; the distance counts down as you walk.
- [ ] ✱ During the 10-second countdown a second line shows "Departing in Ns" under the bar.
- [ ] ✱ Every second, three green sparkles lead towards the target; the other player does not
      see yours (confirms `minecraft:villager_happy` is a valid id on 1.21.90+).
- [ ] ✱ A blind stop (Detour from leg 2) shows only `Detour: X n, Z n`: no bar, no trail.
- [ ] ✱ In the Nether the bar reads "Return to the Overworld"; paused or eliminated racers
      see nothing.
- [ ] ✱ The action bar really shows two lines (`\n` works on 1.21.90+).
- [ ] ✱ `race:pause` blanks the HUD and stops the trail; resuming brings both back.
- [ ] ✱ The HUD yaw matches facing (the `getRotation().y` sign is the one the bar assumes).

### G10 — Pit Stop & leg end (not ✱; run these on the first real leg)

- [ ] Reaching the Pit Stop mat (the checkered 3 × 3, south of the arena's centre) with all
      teammates checks the team in: chat says "Team … — you are team number n!". Standing
      3 blocks off does not.
- [ ] The leg winner gets 5 levels and sees a firework (a plain rocket may vanish without
      bursting; note what it does).
- [ ] With a penalty owed (use the debug state or wait for G14+), the team is held on the mat,
      the action bar shows "Checking in: Ns", and a team arriving meanwhile is placed ahead.
- [ ] When one team is left, chat announces 60 seconds of grace; the action bar of that team
      shows "Grace: Ns".
- [ ] An elimination leg: the last team is set to Spectator, loses the Passport and shows
      `[OUT]`; a non-elimination leg only announces the Speed Bump.
- [ ] Rest: everyone is frozen for 20 seconds, healed and fed (instant health and saturation),
      then "Leg n begins." with the new clue; the old beam goes out and the new one lights.
- [ ] Departures are staggered by the finish gap (max 45 s); a team released early can play
      while the others still show "Departing in Ns".
- [ ] Host menu → End leg now (confirm) works with any number of teams out: those that never
      arrived are teleported to the mat and placed by how far they got, and the last is
      eliminated or gets the Speed Bump. It is not offered during the rest or on the final leg.
- [ ] Final leg: the first team on the Finish mat wins ("… wins the Amazing Race!"); the race
      ends when all are in or 60 s later, and everyone can move.
- [ ] A reload during rest or a departure countdown re-locks the racers (see #39 for the
      reload pausing the race).

### G11 — Physical tasks ✱

Run with 2 players on 1.21.90+, a generated course with Detour and Roadblock stops (use
`/scriptevent race:dump` to read their options). Arena protection arrived with G16; before it,
racers could break course blocks.

- [ ] Clue box of an Aim/Climb Detour: the first click starts Aim; chat/title says "Aim: targets
      0/4"; the arena's west edge (x−9) shows 6 free-standing target blocks at the spec heights; every online member
      receives a bow and 24 arrows. A second click shows the progress and builds nothing.
- [ ] Shooting a target from 8+ blocks away counts (action bar "Aim: targets 1/4"); the same
      target twice, a target from under 8 blocks, and a shot at any other block do not. Four
      different targets finish it: title and chat show the next clue and the sidebar moves.
- [ ] `projectileHitBlock` reports the shooter's location and the target block as the core
      assumes (note what a hit on a target's side face reports).
- [ ] A second team starting the same Detour does not rebuild the zone (no blocks reset under
      the first team).
- [ ] Climb (or Hike): a white concrete line with 1-block gaps rising every 2 jumps ends in a
      gold block (leg 3+: 6 jumps, 2-block gaps); standing on the gold block finishes it within
      about half a second; standing beside or below it does not.
- [ ] Find/Dig: a 5 × 5 × 3 hay pile with yellow wool hidden inside, one wool per team; breaking
      a wool finishes it for the breaker's team; with a second team still digging, the pile is
      rebuilt when the last wool is gone.
- [ ] Roadblock: the player who clicked the box is the performer; a teammate's shots or breaks
      do not count, and only the performer must be within 10 blocks on later clicks.
- [ ] A Quiz or Recall stop asks questions in a form (see G13).

### G12 — Combat and inventory tasks ✱

Run with 2 players on 1.21.90+ on Easy or harder, a generated course with Fight/Brawn (Hunt) and
Muscle/Haul (Gather) stops (use `/scriptevent race:dump`; a Detour box starts its first playable
option, a Roadblock makes the clicker the performer).

- [ ] Hunt: the first click spawns 3 husks (4 from leg 3) at the zone centre, each named with the
      team colour, team name and "Target"; the title says "targets 0/3". Other teams' husks are
      told apart by that name. Husks do not burn in daylight.
- [ ] A husk killed by a team member (sword, and also an arrow) counts: action bar "targets 1/3".
      Note whether `damagingEntity` is the shooter for an arrow kill.
- [ ] A husk killed by a player of another team, by fall damage, by `/kill` or in the void comes
      back as one new husk and the count does not move. Check `deadEntity` is still valid and
      its tag readable in `entityDie` (log `targetDied` / no `guard` error).
- [ ] The last kill finishes the Detour: title, chat and sidebar move on.
- [ ] Husk survival: a named husk stays when everyone walks away 100+ blocks and comes back; a
      husk that wanders into water (turns into a zombie) still counts when killed; `/difficulty
      peaceful` removes them, and using the box again then logs `spawnTargetsFailed` or leaves no
      husk (note which).
- [ ] Using the box again with a husk missing tops up to the number left, never above it, and
      does not double-spawn while a husk is dying.
- [ ] Hunt Roadblock: only the performer's kills count; a teammate's kill respawns the husk.
- [ ] Gather: the title names the item list from the stop's terrain (check desert, forest,
      mountain); the first box click gives nothing and takes nothing.
- [ ] A second box click while the team holds the items between them (split across both
      players) removes exactly the required count (the rest stay), then shows the next clue; any
      wood type counts in a forest; a short pile says "you hold n of m" and removes nothing.
- [ ] Inventory tally: items in the hotbar, main inventory and stacks over several slots all
      count; a partial stack is reduced, not removed.

### G13 — Quiz and Recall ✱

Run with 2 players on 1.21.90+, a generated course with a Brains/Brawn or quiz Roadblock stop
and a final leg (Recall). Use `/scriptevent race:dump` to find them.

- [ ] Brains (quiz Detour) or a quiz Roadblock: the box opens a form titled "…: Question 1 of 4"
      (3 on a Roadblock) with one text field; the form opens the tick after the click.
- [ ] A right answer in any case, with punctuation, or by an alias ("The Nether") is accepted
      and the next question opens at once; the last one sends the next clue.
- [ ] A wrong answer: chat says "Locked out for 10s." and the HUD task line counts the lockout
      down; the box then says how long is left and opens no form; after it, a different
      question opens.
- [ ] Two teammates click the box together: the slower submission is not punished (no
      lockout) and the current question opens again.
- [ ] Roadblock: a teammate who is not the performer cannot answer.
- [ ] Closing the form with Escape asks nothing and costs nothing; the box asks again.
- [ ] Spot-check the bank: 5 trivia answers, 3 anagrams and 3 sums are right and sensible.
- [ ] Recall (final leg Roadblock): one dropdown per earlier leg, each listing every Pit Stop
      name (shuffled differently after a wrong submission); matching all of them finishes the
      race task, any wrong one locks the team out for 20 s. Note whether the dropdown labels and
      a text field give the expected `formValues` (no extra slots). Check the Recall form's
      title ("Recall: Which Pit Stop did you check in at, leg by leg?") is not cut off.

### G14 — Detour and Roadblock flow ✱

Run with 2 players on 1.21.90+ at a Detour and a Roadblock (`/scriptevent race:dump` lists them).

- [ ] Detour box: a menu lists the two option names; the choice starts that option (zone, gear
      for both players). Closing the menu with Escape starts nothing; the box shows it again.
- [ ] Mid-task the menu shows the progress, and Get gear again, Switch to … and Quit (+6 h);
      Hand in (Muscle) or Answer questions (Brains, Mind) appear for those kinds only.
- [ ] Switch to the other option and back: both progresses are kept; the zone of each is built.
- [ ] Quit asks to confirm; Yes gives the next clue, chat says +6 h, and the team then waits
      180 s on the Pit Stop mat before checking in. Keep playing changes nothing.
- [ ] Roadblock box: the menu shows only the hint and the member names; after one name is
      picked the task is revealed to the team and only the performer gets the gear.
- [ ] Both players open the Roadblock menu at once: only the first pick counts, the other is
      told who is performing.
- [ ] A player who already performed is missing from the list on the next Roadblock (2 players,
      2 Roadblocks), and everyone is listed again when all are at the cap.
- [ ] Performer logs out mid-Roadblock: the other player's box shows only Quit (+4 h).
- [ ] Drop the bow, use the box, Get gear again: a bow and the missing arrows are given, no
      duplicates. Hand in with the items in the inventory when the menu opened but moved away
      before pressing the button: only what is held at the press counts.
- [ ] Choose Mind (Muscle/Mind) and answer a question. Two players pick different options at
      once: the second is told what the team is doing.
- [ ] Hunt: the menu has no Get gear again; switch to the other option and back: no extra
      husks beyond the kills still missing.
- [ ] A menu left open while a teammate finished the task does nothing when pressed (log
      `taskChoiceIgnored`).

### G15 — Advantages ✱

Run with 3 teams on a plan of 4 legs or more (the Express Pass is not given with 2).

- [ ] The leg 1 winner is told it won an Express Pass; the Passport shows it (until leg 2 of 4).
- [ ] At a Detour on leg 2, a team with nothing started sees the U-Turn board (targets + "No
      U-Turn"); No U-Turn shows the options; Escape shows the board again on the next use.
- [ ] A U-Turn announces itself in chat and tells the target; the target's option menu says it
      must do both. Finishing one side moves it to the other with a title; then it moves on.
- [ ] Express Pass on a normal Detour skips it; on a U-Turned Detour it skips one side only.
- [ ] Express Pass at a Roadblock (pick menu and mid-task); never offered on the final leg;
      gone after the end of leg 2 of 4.
- [ ] The last team of a non-elimination leg is told it has a Speed Bump; its next Route Info
      box asks 2 questions (a wrong answer locks out 10 s); the clue comes after the second.
- [ ] With an Express Pass the Speed Bump box shows Start / Use Express Pass; Quit asks, costs
      120 s on the Pit Stop mat, and gives the clue.
- [ ] A Speed Bump form title (Speed Bump: Question 1 of 2) reads fully; the Passport shows
      the Speed Bump and U-Turn lines with real leg numbers.
- [ ] A U-Turned team sees the board at the Detour and can use its own U-Turn.

### G16 — Rules enforcement ✱

Run with 2 players (3 for separation) on a generated course; `/gamerule` and Creative are off
limits while testing (use a second account for a non-racer).

- [ ] Walk past R+200 from the start line (R+200 and R+300 are in the plan summary): the title
      and chat warn with a compass direction; coming back clears it; staying 10 s sends you
      to your last in-bounds spot (about 2 s old). Past R+300 sends you back at once.
- [ ] Enter the Nether (or any other dimension): you are brought back to the Overworld within
      about 2 s, once, without a loop.
- [ ] Two teammates 30+ blocks apart: a warning at 10 s, +0.5 h at 15 s (Passport / HUD show the
      penalty), nothing again for 60 s. Standing together resets the timer.
- [ ] No separation penalty during the start countdown, a rest, a Pit Stop wait, within 30 s of
      a teammate dying or rejoining, or while a Roadblock's others wait within 40 blocks.
- [ ] Gliding (give yourself an elytra with a command): +0.5 h, only once in the leg; both the
      elytra and any ender pearls are gone from the inventory, the chest slot and the offhand
      within 10 s.
- [ ] In a lit arena a racer cannot break floor, flags, torches, targets, platforms or a
      clue box; a cancelled break shows "The arena is protected." and counts for no task.
      Hay and yellow wool of a haystack pile can be broken; hay outside the pile cannot.
- [ ] A non-racer (host not on a team, other account) can break arena blocks but not the hay
      and wool of a pile (#50).
- [ ] A block a racer places in a lit arena disappears and returns to the inventory (try a
      slab, a door, tall grass and redstone: does the right item come back, is a door's upper half
      left behind, is the replaced grass lost? note which fail); the same in
      an unlit arena or outside works normally.
- [ ] Hostile mobs in a lit arena vanish within 5 s; a Hunt's husks stay while the team plays
      that Hunt, and disappear after Quit or a Switch away (a switch back tops them up). With
      two teams on two Hunts at once, both keep their husks.
- [ ] Pause the race: arena protection still holds, while the boundary and separation timers
      stop. A cancelled break at a pile counts nothing for any task.

### G17 ✱ Sessions & lifecycle

- [ ] Pause: every racer is frozen (cannot move), the clock and daylight stop; Unpause frees
      everyone except a team still in its countdown or on the mat. Does movement permission
      survive a relog while paused and after the world is reopened (#39)? Note it.
- [ ] Close the world mid-race and reopen it: the race is paused and locked; Unpause resumes;
      a countdown that was running finishes or releases (#39).
- [ ] End day mid-leg: positions and time of day are saved, daylight stops. Resume day: the time
      of day returns, each racer is back where they stood (offline ones go to their last stop on
      rejoin), and all are held for 10 s with no penalty.
- [ ] A day ends by itself when the rest begins after the day's planned legs ("Day N complete");
      Resume day puts each team on its Pit Stop mat and the staggered departures go on; the last
      day never ends by itself.
- [ ] The host is reminded once when the day's minutes have passed (race time); nothing ends.
- [ ] Die: you return to your team's last cleared stop, a teammate is told, inventory is kept,
      no penalty; a Roadblock performer keeps the role. Does movement stay locked after a
      respawn during a countdown or a pause?
- [ ] Leave and rejoin: you get the Passport back, the coloured name tag (does it survive a relog without being set again?), and the kit if you
      were offline at the start; you land next to a teammate (or at the last stop); an
      eliminated team's member rejoins as Spectator without a Passport (#46, #40).
- [ ] Team fixes: Add penalty (race minutes: 30 min = 15 s), Skip step (refused at a Pit Stop),
      Teleport me to team, Eliminate team (confirmation; Spectator, husks gone, last team refused).
- [ ] Status lists each team's leg, step, who is online, penalty and advantages.
- [ ] End race: husks vanish, gamerules and time of day return, the sidebar is gone, everyone
      is Survival with their plain name tag and no Passport (#40, #45, #53). Also try it on a
      final leg nobody finished. A player offline at that moment is released on rejoin.

### M4 — Release (G18)

The release check on the packaged add-on, in a fresh world copy with 2 players. The per-group checks above (and the owed runs listed in the follow-up issues) are not repeated here; run those first.

| Check | Result (version, date) |
|---|---|
| `npm run package` output (`dist/AmazingRace.mcaddon`) opens in Minecraft and imports without an error | |
| The pack activates on 1.21.90+ with no experiments and no Content Log errors at world load | |
| Race Control opens the host menu; the Passport opens its menu for a racer | |
| Setup → Teams → Generate course → arenas built → Start race on a real world | |
| Beacon beams stand over the next stop's arena; the HUD arrow points at it | |
| One Detour and one Roadblock played to the end; the team checks in on the mat | |
| End day, close the world, reopen it: the day resumes where each team stood (Resume day) | |
| End race restores the daylight cycle and time of day and releases both players | |
