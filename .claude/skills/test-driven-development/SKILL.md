---
name: test-driven-development
description: Work test-first (red, green, refactor) and prove that core rules, the Minecraft adapter and persistence work together. Use when implementing a feature or bug fix, choosing what kind of test to write, or reviewing tests.
---

# Test-driven development

Two habits: every behaviour change starts as a failing test, and a feature is not proven until
a test shows the pieces it crosses cooperate.

**Project specifics come from the project.** `CLAUDE.md` and the design documents it points to
define the test commands, layers, helpers and the current task's acceptance points. Where they
are explicit, they win.

## 1. Red, green, refactor

1. **Red:** the smallest test stating the next rule; watch it fail for the expected reason (an
   assertion, not an import error).
2. **Green:** the least code that passes.
3. **Refactor** on green only; rerun.

- **Start from the outside:** one failing scenario test for the feature, then drive the inside
  with unit tests.
- **One rule per test,** named after the rule, not the function.
- **Bugs start as a failing test** at the lowest level that shows them.
- **Assert behaviour:** returned state, emitted effects, state after save/load. Not private
  helpers or call order.
- **Never weaken or skip a test** to get green.

## 2. Pick the cheapest test that can fail for the right reason

| Question | Test |
|---|---|
| Is a rule or calculation right? | Pure unit test on the core, many cases |
| Does a generated result meet its invariants for any input? | Property test over many seeds |
| Does an action produce the right effects? | Core test: state + action → state + effects |
| Do several systems cooperate on a flow? | Simulation: a fake world executes the effects |
| Does state survive persistence? | Save → load round trip, including large state |
| Does it compile against the stable API? | Typecheck |
| Does it work in the game? | In-game checklist, at least 2 players |

Fake only what Node cannot run: the Minecraft world, time and randomness (seeded). A fake world
executes effects; it never re-implements rules.

## 3. Test the connections

Defects live between pieces: an effect nobody executes, a form that bypasses core validation,
a field lost on save, a timer that ignores pause.

Map the flow first (event → action → core decision → effects → world → save) and prove each
arrow the change touches:

- the event maps to the right action;
- the effect visibly changes the (fake) world;
- refusals reach the player and change no state;
- timers follow the race clock, so pause and day end freeze them;
- after save and reload, the outcome is identical;
- one team's private information never reaches another.

## 4. Done means

- Each acceptance point maps to a named test that was seen failing first.
- Each connection the change touches has a test crossing it.
- The project's typecheck, test and package commands pass; nothing skipped.
- What only the game can prove is added to the in-game checklist and noted in the PR.

Coverage is a map: an uncovered core line is an unstated rule (test it) or dead code (delete
it). A test that survives breaking the code it covers is shallow.

## Reviewing tests

Report only findings that would change the tests, as

```
<file>:<line> — <gap>: <what is unproven> → <test to add or change>
```

ordered by impact: untested connection, test that can't fail for the right reason, missing
unhappy path (offline player, unloaded chunk, wrong answer), naming.
