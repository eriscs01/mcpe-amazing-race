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

## Model roles

Sonnet builds, Haiku explores, Opus reviews. Each model does what it is best at, and Opus context is spent only where it changes the outcome.

| Role | Model | Where | Does |
|---|---|---|---|
| Lead | Sonnet | the main session (`model` in `.claude/settings.json`) | directs the group, writes tests and code, runs the checks, talks to the user |
| Explorer | Haiku | `explorer` agent | reads code, spec, design and typings in parallel and reports `path:line` facts |
| Reviewer | Sonnet | `reviewer` agent, worktree isolation | the isolated diff review (step 6) |
| Advisor | Opus | `advisor` agent | only at the three checkpoints below |

- **Explore before reading.** For any question answered by reading more than a couple of files, send `explorer` agents (several at once for independent questions) instead of reading in the lead session. Give each one a precise question and act on its summary.
- **Opus checkpoints (and only these):**
  1. **Plan review** before the first test of a group (step 3).
  2. **Unblock** when the same error survives two fix attempts: send the error, what was tried and the files involved. Don't try a third blind fix.
  3. **Completeness check** before opening the PR (step 7).
- Each agent starts cold: give it the group, the question or checkpoint, and the paths it needs, not "see above". Relay its verdict to the user only where it changes a decision.

## Group workflow

Each implementation group goes through these steps in order:

1. **Branch** from the latest `main`, named for the group (e.g. `feat/g2-state-clock`).
2. **Explore** (Haiku): `explorer` agents in parallel gather the group's spec sections, technical-design rows (§2, §3, §4), the code it builds on, open follow-ups from earlier groups, and any Script API typings it needs.
3. **Plan, then advisor review** (Opus checkpoint 1): the lead writes a short plan (scope, modules and types, tests to write first, §3 decisions needed); `advisor` reviews it. Settle STOP or GO WITH CHANGES items, and escalate genuine judgement calls to the user, before coding.
4. **TDD** (Sonnet): failing test first, then code, per the `test-driven-development` skill. Repeated failure → Opus checkpoint 2.
5. **Local checks:** typecheck, lint, coverage and package pass.
6. **Isolated review** (Sonnet): the `reviewer` agent, in its own worktree, reviews the branch diff read-only against the spec, technical design, this file and the skills, and returns a verdict and ranked findings. Fix what matters; note what was left and why.
7. **Completeness check** (Opus checkpoint 3): `advisor` checks the final diff against the group's scope, docs and tests. Fix gaps, then open the PR.
8. **Address findings from CI on the PR.** Fix what matters; report what was left and why.
9. **After merge, clean up:** delete the merged local and remote branch, remove agent worktrees (`.claude/worktrees/`), and drop build output and other data the next group doesn't need (`build/`, `dist/`).
10. **Stop.** Do not start the next group until told to. Report follow-ups first (open review nits, deferred items, in-game checks, spec questions) so each can be implemented or deferred.
