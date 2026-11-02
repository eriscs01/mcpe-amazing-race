---
name: test-driven-development
description: Write code test-first (red, green, refactor) for this Bedrock add-on and prove that core rules, the Minecraft adapter and persistence work together. Use when implementing a feature, rule, challenge kind or bug fix; when a change crosses the src/core ↔ src/mc boundary or spans several systems (clue box → engine → effects, leg end → departures, save → load); when choosing which kind of test to write; when reviewing tests; or when the user asks about TDD, simulation, integration or in-game tests.
---

# Test-driven development for the add-on

Two habits. Every behaviour change starts as a failing test. And a feature is not proven until
a test shows the pieces it crosses cooperate: the event that starts it, the core rule that
decides, the effects that change the world, and the state that survives a save.

The project's own rules come first: `CLAUDE.md`, `docs/technical-design.md` §2.9 (test layers)
and the acceptance points of the current implementation group (§4). Where explicit, they win.

## 1. The loop: red, green, refactor

1. **Red.** Write the smallest test that states the next rule, run it, and watch it fail **for
   the expected reason** (an assertion, not an import error).
2. **Green.** Write the least code that passes. Hard-coding is fine if the next test forces the
   generalisation.
3. **Refactor** on green only, then run the suite again.

Rules:

- **Start from the outside.** For a feature, first write one failing test at the outermost
  level it touches — usually a `fakeWorld` scenario ("a team that quits a Detour checks in
  180 s later"). Leave it red and drive the inside with unit tests.
- **One rule per test**, named after the rule ("the last team on an elimination leg is
  eliminated"), not the function.
- **Bugs start as a test** at the lowest level that shows them; if the bug lived between core
  and adapter, the test crosses that boundary.
- **Test behaviour.** Assert on returned state, emitted effects and state read back after a
  save/load — not on private helpers or call order.
- **Never weaken or skip a test** to get green; report failing output as it is.

## 2. Pick the cheapest test that can fail for the right reason

| Question | Test kind | Where |
|---|---|---|
| Is this rule or calculation right (plan math, schedule, caps, compass bar, quiz normaliser, terrain classification)? | Unit, pure, many cases | `test/*.test.ts` against `src/core` |
| Does a course meet every placement rule for any seed? | Property test: many seeds, assert all invariants (spacing ≥ 300, within R, segments 600–900, finish ≤ 400 from start, unique names) | `test/course.test.ts` |
| Does an action produce the right effects? | Engine test: `(state, action) → effects` | `test/race/*.test.ts` |
| Do several systems cooperate on a flow? | Simulation with `test/sim/fakeWorld.ts` executing effects | `test/sim/*.test.ts` |
| Does state survive persistence? | Round trip through the chunked store with a fake property map, including > 30,000-char state | `test/store.test.ts` |
| Does the code compile against the stable API? | `npm run typecheck` (2.0.0 typings, no Beta) | CI |
| Are identifiers valid? | Compare `config.ts` ids with `@minecraft/vanilla-data` enums | `test/ids.test.ts` |
| Does it work in the real game? | In-game checklist, 1.21.90+, ≥ 2 players | `docs/ingame-test.md` |

Fake only what you cannot run in Node: the Minecraft world, the clock source and randomness
(seeded `rng`). Never fake core rules inside a simulation; the fake world executes effects, it
doesn't decide.

## 3. Test the connections

Defects live between systems: an effect the executor ignores, a form that skips the engine's
validation, a field lost on save, a timer using `system.currentTick` instead of the race clock.

**Map the flow first.** E.g. clue box: `beforeEvents.playerInteractWithBlock` → cancel →
`system.run` → `dispatch(ClueBoxUsed)` → engine (target? presence? step) → effects (form,
title, chat, light next stop) → dirty → save. Each arrow is a connection to prove.

Per connection the change touches:

- **Event → action.** The adapter maps the event to the right action (adapter test with a fake
  event object, asserting the dispatched action).
- **Action → effects → world.** In `fakeWorld`, the effect visibly changes the world
  (player teleported, block lit, item removed).
- **Refusals across the boundary.** "Not your clue box" / "All teammates must be present" reach
  the player as a message and change no state.
- **Clock-driven rules.** Advance the fake clock; pause and day-end must freeze every timer.
- **Persistence.** After the step, save → reload → continue; the outcome is identical.
- **Isolation between teams.** One team's HUD, clue and progress never appear for another.

Required §14.3 scenario: 9 players, team size 3, 3 days, flat terrain — elimination schedule,
Roadblock caps, U-Turn targeting, Express Pass expiry, penalty-ordered check-in, multi-day
resume, save/load round trip.

## 4. Before calling the work done

- Every acceptance point of the group maps to a named test, each seen failing first.
- Every core↔adapter connection the change touches has a test that crosses it.
- `npm run typecheck && npm test && npm run package` pass; nothing skipped or focused.
- Items that only the game can prove are added to `docs/ingame-test.md` and marked in the PR.

## 5. Coverage is a map, not a goal

Read uncovered core lines as unstated rules: write the test, or delete dead code. A test that
still passes when you break the code it covers is shallow. `src/mc` is proven mainly by
simulation and in-game runs; `src/core` should be close to fully covered.

## How to use this skill

**When implementing:** map the flow (3), write the outermost failing test, loop inward (1),
choose levels with (2), finish with (4).

**When reviewing tests:** report only findings that would change the tests, each as

```
<file>:<line> — <gap>: <what is unproven or wrong> → <test to add or change>
```

ordered by impact: an untested connection first, then a test that can't fail for the right
reason (rules faked in the simulation, hand-built intermediate values), then missing unhappy
paths (offline player, unloaded chunk, wrong answer lockout), then naming.
