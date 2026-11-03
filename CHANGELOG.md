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

## [0.1.0]

### Added
- Project scaffold: behavior pack manifest, build and `.mcaddon` packaging, CI.
