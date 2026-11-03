---
name: group-workflow
description: Run one implementation group (technical design §4, G1–G18) end to end - branch, explore (incl. open follow-up issues), plan with advisor review, TDD, checks, isolated review, completeness check, PR, cleanup, log follow-ups as issues, stop - with Sonnet building, Haiku exploring and Opus reviewing. Use when starting or continuing a group, e.g. "/group-workflow G6" or "start G6".
argument-hint: G<n>
---

# Group workflow

Group to run: **$ARGUMENTS** (e.g. `G6`). Its scope is its row in `docs/technical-design.md` §4; stay inside it, plus any follow-up issues the plan takes in (step 3).

## Model roles

Sonnet builds, Haiku explores, Opus reviews. Each model does what it is best at, and Opus context is spent only where it changes the outcome.

| Role | Model | Where | Does |
|---|---|---|---|
| Lead | Sonnet | the main session (default `model` in `.claude/settings.json`; `--model`, `/model` or the environment can override it) | directs the group, writes tests and code, runs the checks, talks to the user |
| Explorer | Haiku | `explorer` agent | reads code, spec, design, typings and issues in parallel and reports `path:line` facts |
| Reviewer | Sonnet | `reviewer` agent, `isolation: "worktree"` | the isolated diff review (step 6) |
| Advisor | Opus | `advisor` agent | only at the three checkpoints below |

- **Explore before reading.** For any question answered by reading more than a couple of files, send `explorer` agents instead of reading in the lead session; launch independent ones in the same message so they run in parallel. Give each one a precise question and act on its summary; reopen a file yourself only to edit it.
- **Opus checkpoints (and only these):**
  1. **Plan review** before the first test of a group (step 3).
  2. **Unblock** when the same error survives two fix attempts: send the error, what was tried and the files involved. Don't try a third blind fix.
  3. **Completeness check** before opening the PR (step 7).
- Each agent starts cold: give it the group, the question or checkpoint, and the paths it needs, not "see above". Relay its verdict to the user only where it changes a decision.
- Long commands (full coverage runs, fuzz scripts) run in the background while you keep working.

## Follow-up issues

Follow-ups (deferred review findings, open spec questions, in-game checks not yet run, tooling debt) live as GitHub issues labelled **`follow-up`**, using `.github/ISSUE_TEMPLATE/follow-up.md`: origin (group and PR), what and why, the group it best fits (or "any"), and "done when". They are never kept only in chat.

- **Read them first** (step 2) and **decide in the plan** (step 3) which ones this group takes in: those that touch the same modules, are needed by this group's work, or are small enough to ride along without widening the review. Name the rest as deferred with a one-line reason.
- **Close them through the PR:** list taken-in issues in the PR body as `Closes #n`, so merging closes them.
- **File new ones** at step 10, and edit an existing issue instead of filing a duplicate.

## Steps

In order:

1. **Branch** from the latest `main`, named for the group (e.g. `feat/g2-state-clock`).
2. **Explore** (Haiku), in parallel: the group's spec sections; its technical-design rows (§2 conventions, §3 decisions, §4 scope and dependencies); the code it builds on; Script API typings it needs; and the open `follow-up` issues, each marked fits / maybe / no for this group with a reason.
3. **Plan, then advisor review** (Opus checkpoint 1). The lead writes a short plan: scope, modules and types, tests to write first, §3 decisions needed, and follow-up issues taken in or deferred. `advisor` reviews it. Settle STOP or GO WITH CHANGES items, and escalate genuine judgement calls to the user, before coding. The plan goes into the PR body later.
4. **TDD** (Sonnet): failing test first, then code, per the `test-driven-development` skill, applying `design-principles` and `debuggability` as you go. Repeated failure → Opus checkpoint 2.
5. **Local checks:** `npm run typecheck`, `npm run lint`, `npm run coverage` (≥80% of `src/core` lines) and `npm run package` pass. Update the technical design (§2/§3) and `CHANGELOG.md`; add ✱ items to `docs/ingame-test.md`.
6. **Isolated review** (Sonnet): **commit first** (a worktree sees only committed work), then launch `reviewer` with `isolation: "worktree"`. It reviews the branch diff read-only against the spec, technical design, `CLAUDE.md` and the skills, and returns a verdict and ranked findings. Fix what matters; note what was left and why.
7. **Completeness check** (Opus checkpoint 3): review the diff yourself with the `design-principles` skill, then `advisor` checks the final diff against the group's scope, the plan's taken-in issues, docs and tests. Fix gaps, push, and open the PR: summary, the plan, `Closes #n` for taken-in issues, review outcome and what was left, check results, and for ✱ groups the in-game result from `docs/ingame-test.md` (or that it is still owed).
8. **Address findings from CI on the PR.** Fix what matters; report what was left and why.
9. **After merge, clean up:** delete the merged local and remote branch, remove agent worktrees (`.claude/worktrees/`) and their branches, and drop build output and other data the next group doesn't need (`build/`, `dist/`, `behavior_pack/scripts/`).
10. **Log follow-ups and stop.** File every new follow-up as an issue (see above): open review nits, deferred items, in-game checks owed, spec questions. Then report to the user: the merge, the issues closed, and the new or still-open issues as links, with a recommendation (do next / defer) for each that needs a decision. Do not start the next group until told to.

## Done when

- [ ] Every spec item in the group's §4 row is implemented and tested, or deferred as an issue.
- [ ] Taken-in follow-up issues are closed by the PR; new ones are filed.
- [ ] The four local checks pass, and CI is green on the PR's head.
- [ ] Review findings are fixed, or left with a reason stated in the PR.
- [ ] Docs are current: technical design, `CHANGELOG.md`, `docs/ingame-test.md`.
- [ ] After merge: branches, worktrees and build output are gone, and the user has the report.
