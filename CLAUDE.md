# Amazing Race (Minecraft Bedrock add-on)

Behavior-pack-only add-on. What to build: `docs/amazing-race-addon-spec.md` (the spec). How the code is shaped and the order of work: `docs/technical-design.md`. Read the relevant sections before changing anything; the spec wins on behaviour, the technical design on structure.

## Layout

```
src/core/        game rules; NEVER imports @minecraft/*
src/mc/          Minecraft adapter: events → actions, effects → world
src/main.ts      event wiring; init inside world.afterEvents.worldLoad
test/            node:test unit tests and fakeWorld simulations (core only)
behavior_pack/   manifest; build output goes to behavior_pack/scripts/
scripts/         packaging (.mcaddon)
docs/            spec, technical design, in-game test checklist
```

## Working rules

- Stable APIs only: `@minecraft/server` 2.0.0 and `@minecraft/server-ui` 2.0.0. No Beta, no experiments, no resource pack, vanilla identifiers only.
- One implementation group (technical design §4, G1–G18) per branch and PR. Stay in its scope.
- Module ownership, extension points, test layers and logging conventions: technical design §2. Keep it current when they change; the skills defer to it.
- Relative imports end in `.js` (NodeNext).
- Typecheck after every edit to a TS/JS file (`npm run typecheck`). A PostToolUse hook does this automatically and reports errors; fix them before moving on.
- Run `npm run typecheck`, `npm test` (once it exists) and `npm run package` before opening a PR; note the in-game check result in the PR when the group is marked ✱.
- Apply the `design-principles` skill while writing code and review the branch diff with it before opening a PR.
- Apply the `test-driven-development` skill: tests first, and prove each core↔adapter connection a change touches.
- Apply the `debuggability` skill: guarded handlers, structured log lines keyed by race clock/team/leg, no swallowed errors.
