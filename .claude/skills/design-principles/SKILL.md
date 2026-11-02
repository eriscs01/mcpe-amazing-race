---
name: design-principles
description: Apply clean code, the Single Responsibility Principle and the Open-Closed Principle to this Bedrock add-on. Use when deciding where new logic belongs (src/core vs src/mc); when splitting or merging a module, file or function; when adding a new case to an existing mechanism (a challenge kind, stop type, effect, host menu screen, penalty, advantage); when reviewing code for design quality; or when the user asks about clean code, SRP, OCP, SOLID, refactoring or code quality.
---

# Design principles

Three principles, read the way their authors meant them, applied to this project. The research
behind each, with sources and criticisms, is in [reference.md](reference.md).

The project's own rules come first: `CLAUDE.md`, the spec (`docs/amazing-race-addon-spec.md`)
and the technical design (`docs/technical-design.md`). Where they are explicit, they win.

## 0. The boundary this project is built on

- **`src/core/**` holds every game rule and never imports `@minecraft/*`.** It takes plain data
  (ids, positions, block type ids, clock ticks) and returns new state plus a list of effects.
- **`src/mc/**` translates.** Events become core actions; effects become world calls. It holds
  no rules. A race `if` in `src/mc` (who may open a clue box, whether a hit counts, how long a
  penalty is) belongs in `src/core`.
- **`src/main.ts` wires only.** It subscribes events at top level and initialises inside
  `world.afterEvents.worldLoad` (no world access at module top level, Script API 2.0).

## 1. Single Responsibility: one owner per reason to change

Martin: "a module should be responsible to one, and only one, actor". Gather what changes for
the same reason; separate what changes for different reasons. It is **not** "a function does
one thing".

Reasons to change in this project, each with its own home:

| Reason to change | Owner |
|---|---|
| Tunable numbers and tables (penalties, radius, colours, gather items, hints) | `core/config.ts` |
| Derived plan, elimination schedule | `core/plan.ts` |
| Course shape (stops, segments, pinned waypoints, names) | `core/course/planner.ts` |
| Terrain classification of a sampled column | `core/course/terrain.ts` |
| One challenge's rules | `core/tasks/<kind>.ts` |
| Leg flow, check-in, placement, eliminations | `core/race/engine.ts` |
| Advantages (U-Turn, Express Pass, Speed Bump) | `core/race/advantages.ts` |
| What the HUD says | `core/hud.ts` |
| How state is stored (chunked dynamic properties) | `mc/store.ts` |
| How the world is read and written (chunks, ticking areas, blocks) | `mc/world.ts`, `mc/terrainProbe.ts`, `mc/builder.ts` |
| How forms look and are retried | `mc/ui/*` |

Checks:

- **Name the actor.** For each file or function you touch, say who would ask for it to change
  (the host experience, a challenge's rules, the Script API, the save format). Two answers mean
  two homes.
- **One rule, one place.** Presence ("all online members within 10 blocks"), eligibility
  (Detour member vs. Roadblock performer), Roadblock caps and penalty amounts are each decided
  once in core. Forms and event handlers call that decision; they never re-check it.
- **No copied facts.** Derived values (current leg, legs per day, whether a team is last,
  whether the Express Pass has expired, sidebar score) are computed from state, not stored a
  second time.
- **Constants live in `config.ts`.** No magic numbers for ticks, distances or counts in logic;
  express real time via `HOUR` / ticks-per-second constants.
- **Don't split by technique.** `helpers.ts`, `validators.ts`, `utils.ts` scatter an actor.
  Split only along a different reason to change.

## 2. Open-Closed: add the new case, don't edit the mechanism

Meyer (1988), Martin (1996), Larman's *Protected Variation* (2001): put a stable interface
around the points you **predict** will vary, and only those.

Predicted variation points in this project (designed extension points):

- **Challenge kinds** → the `TaskKind` interface; a new kind is a new file plus one registry
  entry. The engine never switches on kind.
- **Effects** → a closed `Effect` union executed by `mc/world.ts`; adding one is deliberate
  and the exhaustive switch must flag every handler.
- **Host menu screens** → a phase → `[{label, handler}]` table, not a growing `if` chain.
- **Periodic systems** → registered with a period in `mc/loop.ts`.
- **Persisted state** → versioned (`State.v`); new fields are additive with defaults on load.

Rules:

- **Find the existing extension point first** before adding a case-specific branch.
- **Deliberately closed sets are not violations.** `Phase`, stop types, team status and
  `Effect` are closed unions: use exhaustive `switch` with a `never` check so the compiler finds
  every handler when a member is added.
- **One case is not a pattern.** Don't add an interface for something the spec defines once
  (for example Recall). Write it plainly; abstract when a second real case appears.
- **Extend at the edge.** The core never imports adapters.

## 3. Clean code: readable by the next person

*Clean Code* heuristics as defaults, Ousterhout's *A Philosophy of Software Design* as the
counterweight: prefer deep modules with small interfaces.

- **Use the spec's vocabulary** everywhere: leg, stop, Route Info, Detour, Roadblock, Pit Stop,
  Finish, clue box, mat, performer, Speed Bump, U-Turn, Express Pass, race clock, race hour.
- **Make illegal states unrepresentable.** Discriminated unions over optional-field combos;
  typed ids (`PlayerId`, `TeamId`, `StopId`); `noUncheckedIndexedAccess` stays on.
- **Fail fast on programmer errors** (a malformed config table, an unknown stop id) with a
  named error; handle expected world conditions (unloaded chunk, player offline, form busy)
  as normal outcomes.
- **Identifiers are vanilla and verified.** Every block/item/entity/particle id is a current
  Bedrock id, kept in `config.ts`.
- **Size budget.** The spec targets ~1,500 lines; prefer fewer, deeper modules over many
  shallow ones.
- **Comments say why**, or state a contract the type can't. No dead code, no speculative
  generality, no commented-out blocks. Stay inside the task's implementation group.

## How to use this skill

**When writing code:** decide core vs. adapter (section 0), name the actor (1), look for the
extension point (2), then write it plainly (3).

**When reviewing:** report only findings that would change the code, each as

```
<file>:<line> — <principle>: <what is wrong> → <concrete change>
```

ordered by impact: a core/adapter boundary breach first, then a rule enforced twice or a fact
stored twice, then an adapter making decisions, then a mechanism that needs editing per case,
then readability. Say explicitly when a candidate is a deliberate closed set or a one-case
abstraction you recommend *not* adding. Out-of-scope refactors are follow-ups, not edits.
