# Changelog

Versions follow `package.json`; the release workflow publishes the section matching the tag.

## [Unreleased]

### Added
- Project foundations: config tables, seeded RNG, vector math, test tooling (G1).
- Release packaging: pack icon, manifest metadata, version checks, tagged-release workflow.
- Race state, race clock, phase machine and chunked world persistence; shared logger and
  handler guard (G2).
- Race Control and Race Passport items, host claim / replace / transfer, `/scriptevent race:host`
  and `race:dump`, phase-aware host menu and Passport shell with busy-retry forms (G3).
- Setup screen with the derived plan, elimination schedule, team auto-assign / swap / view
  with the fixed colour list, and the Roadblock cap (G4).
- Course planner: leg skeleton, Detour / Roadblock / Recall assignment, blind segments,
  pinned waypoints, distance-rule walk with look-ahead, candidate choice from terrain probes
  and unique place names (G5).
- Course generation: host landmarks (add, clear), Generate course here, ticking-area terrain
  probe with ground classification and landmark scan, arena offset from landmarks, progress on
  the action bar, List stops and Discard course, failure messages that say what to change,
  recovery from a world closed mid-generation (G6).
- Arenas: 19 × 19 arena at every stop built automatically once the course is ready (floor,
  beacon base, flags, torches, Pit Stop / Finish mat), recognised instead of rebuilt after a
  re-run, lit / unlit switching with a 2-second chunk retry queue restored on reload, task zone
  geometry, Build arenas retry, and `/scriptevent race:light` for checking beacons (G7).
- Race start: Start race in the host menu (refused while an arena is missing), gamerule and
  time snapshot, kit, ring teleport, 10-second movement-locked countdown with a GO title, only
  leg 1 lit (clearing the debug lights), clue boxes with the presence rule, Route Info clues
  and step advance, sidebar scoreboard and race/leg chat announcements (G8).
- Racer HUD: action-bar compass bar with distance and stop label, `<< TURN AROUND >>`, task line
  (penalty, lockout, departure countdown), a private particle trail, and coordinates only for
  blind stops (G9).
- Pit Stop and leg end: mat check-in (all online teammates within 2 blocks), penalty countdown
  with a movement lock, placement and chat, 5 levels and a firework for the leg winner, a
  60-second grace period for the last team, elimination (Spectator, Passport removed) or a Speed
  Bump flag, a 20-second rest with heal and feed, staggered departures (gap behind the winner up
  to 45 s plus any unserved penalty), the final leg's winner and finish, and End leg in the host
  menu (G10).
- Task framework and physical tasks: the `TaskKind` plug-in shape, shared task zones built once
  per zone, Archery (six targets, 4 or 5 distinct hits from 8+ blocks, bow and 24 arrows),
  Parkour (white concrete jumps to a gold block) and Haystack (hidden wool, one per team,
  rebuilt when it runs out), counted for any member on a Detour and the performer on a
  Roadblock, with progress on the HUD task line. A Detour or Roadblock box starts its task
  directly until the full flow arrives (G11).
- Combat and inventory tasks: Hunt (3 or 4 husks named and tagged for the team, a kill by an
  eligible racer counts, any other death respawns it, using the box again tops up missing
  husks) and Gather (the terrain's item list, handed in at the clue box from the team's pooled
  inventory, exactly the required count removed) (G12).
- Quiz and Recall: a question bank (35 trivia questions with sources, arithmetic, mob and item
  anagrams), answers matched after normalising with aliases, one question per clue-box form,
  a 10-second lockout for a wrong Quiz answer and 20 seconds for a wrong Recall submission,
  and Recall's one dropdown per earlier leg listing the Pit Stops shuffled (G13).
- Detour and Roadblock flow: a clue-box menu to choose the Detour option or the Roadblock
  performer (hint first, capped per player), switch option with progress kept, Get gear again
  (only what is missing), Hand in tallied fresh, and Quit with a confirmation and the 6 h / 4 h
  penalty served at the Pit Stop; any member may quit while the performer is offline (G14).
- Advantages: the Express Pass (leg 1 winner, usable on a Detour, Roadblock or Speed Bump until
  leg ceil(L/2) and never on the final leg), the U-Turn board on the first visit to a Detour with
  both options required of the target, the Speed Bump quiz at the next leg's Route Info, and the
  Passport listing them (G15).
- Rules enforcement: course boundary with a warning, a return to the last in-bounds position
  and a return from other dimensions; teammate separation (warning at 10 s, 0.5 h at 15 s) with
  its exemptions; the 0.5 h gliding penalty once per leg; elytra and ender pearls removed every
  10 s; lit arenas protected (only a haystack pile's hay and wool may be broken, placed blocks
  are taken back) and hostile mobs swept every 5 s except the husks of a Hunt in play (G16).
  Position reports that only move a timer are saved with the periodic save.
- Sessions and lifecycle: pause / unpause, End day (host or automatic after the day's planned
  legs) with saved positions and time of day, Resume day (Pit Stop teams to their mat, others
  back where they stood after a 10 s hold), the minutes reminder, death back to the last cleared
  stop, rejoin (kit, name tag, lock, Spectator, teammate), host Team fixes (penalty, skip,
  go to team, eliminate), Status and End race (husks, gamerules and time restored, sidebar
  removed, players released) (G17).

## [0.1.0]

### Added
- Project scaffold: behavior pack manifest, build and `.mcaddon` packaging, CI.
