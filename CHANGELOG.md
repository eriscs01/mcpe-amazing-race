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

## [0.1.0]

### Added
- Project scaffold: behavior pack manifest, build and `.mcaddon` packaging, CI.
