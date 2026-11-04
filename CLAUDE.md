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
- Code style is Airbnb (`eslint-config-airbnb-extended`, type-aware, formatting included); plus Microsoft's `eslint-plugin-minecraft-linting` (prefer a Script API over `runCommand`); deviations and their reasons are in `eslint.config.mjs`. Run `npm run format` after editing; `npm run lint` fails on any warning.
- Every edit is checked like CI does: a PostToolUse hook (`.claude/hooks/check-on-edit.sh`) runs ESLint with `--fix` on the edited file (formatting is corrected in place; re-read the file before editing it again) and an incremental typecheck, and reports what's left. Fix it before moving on.
- Run `npm run typecheck`, `npm run lint`, `npm run coverage` and `npm run package` before opening a PR (CI enforces all four; coverage must stay at or above 80% of `src/core` lines); note the in-game check result in the PR when the group is marked ✱.
- Apply the `design-principles` skill while writing code and review the branch diff with it before opening a PR.
- Apply the `test-driven-development` skill: tests first, and prove each core↔adapter connection a change touches.
- Apply the `debuggability` skill: guarded handlers, structured log lines keyed by race clock/team/leg, no swallowed errors.

## Group workflow

Every implementation group follows the `group-workflow` skill (`/group-workflow G<n>`): branch, explore (Haiku), plan + advisor review (Opus), TDD (Sonnet), local checks, isolated review, completeness check, PR and CI, cleanup after merge, then log follow-ups and **stop**. Never start the next group until told to.

When a group is finished the workflow sends a Pushover notification with `scripts/notify.sh`; its credentials (`PUSHOVER_USER_KEY`, `PUSHOVER_APP_KEY`) live in the cloud environment's settings, never in the repository.

Follow-ups are GitHub issues labelled `follow-up` (template in `.github/ISSUE_TEMPLATE/follow-up.md`), never only chat. Each group reads the open ones first and takes in those that fit; its PR closes them with `Closes #n`.
