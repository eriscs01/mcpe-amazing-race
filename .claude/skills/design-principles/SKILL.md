---
name: design-principles
description: Apply SRP, the Open-Closed Principle and clean code to decide where logic belongs and how to extend it. Use when adding or moving logic, adding a new case to an existing mechanism, splitting a module, or reviewing design quality.
---

# Design principles

Background and sources for each principle: [reference.md](reference.md).

**Project specifics come from the project, not this skill.** Read `CLAUDE.md` and the design
documents it points to for the current layout, module ownership and extension points. Where
they are explicit, they win. This skill explains the reasoning and covers what they leave open.

## 0. Rules live in the core, Minecraft lives in the adapter

- Game rules are pure: plain data in, new state and a list of effects out. They never import
  `@minecraft/*`, so they can be tested in Node.
- The adapter translates only: events become actions, effects become world calls. A race
  decision (who may act, whether something counts, how long a penalty is) found in the adapter
  belongs in the core.
- The entry point only wires. No world access at module top level (Script API 2.0).

## 1. Single Responsibility: one owner per reason to change

A module answers to one actor: gather what changes for the same reason, separate what changes
for different reasons. It is not "a function does one thing".

Typical separate reasons in this project: tunable numbers and tables; one domain rule set
(course, a challenge, leg flow, advantages); what players are shown; how state is stored; how
the world is read and written; how forms behave.

- **Name the actor** for each file or function you touch. Two answers mean two homes.
- **One rule, one place.** A rule (presence, eligibility, caps, penalties) is decided once by
  its owner; forms and handlers call it, never re-check it.
- **No copied facts.** Derive values from state instead of storing them twice.
- **Tunables in config**, not as magic numbers in logic.
- **Don't split by technique** (`helpers`, `utils`, `validators`); split only along a
  different reason to change.

## 2. Open-Closed: add the new case, don't edit the mechanism

Put a stable interface around points that are **predicted** to vary, and only those.

- **Find the existing extension point first** (a registry, a handler table, an interface such
  as a challenge kind). Add to it instead of branching in the code that consumes it.
- **A growing `if (kind === …)` chain** wants a map or interface owned by whoever defines the
  kinds.
- **Closed sets are deliberate.** Phases, statuses, stop types and effect kinds are closed
  unions: use exhaustive `switch` with a `never` check so the compiler finds every handler.
- **One case is not a pattern.** Abstract when the second real case arrives.
- **Persisted formats grow additively**, with a schema version and defaults on load.
- **Extend at the edge.** The core never imports the adapter.

## 3. Clean code

Defaults from *Clean Code*, balanced by Ousterhout: prefer deep modules with small interfaces
over many shallow ones; judge by how hard code is to understand and change.

- **Use the spec's vocabulary** consistently (leg, stop, clue box, Detour, Roadblock, Pit Stop,
  race clock…).
- **Make illegal states unrepresentable:** discriminated unions, typed ids, strict compiler
  settings stay on.
- **Fail fast on programmer errors**; treat expected world conditions (unloaded chunk, player
  offline, busy form) as normal outcomes.
- **Vanilla identifiers only**, verified, kept with the other tunables.
- **Comments say why.** No dead code, no speculative generality. Stay inside the task's scope.

## How to use

**Writing:** core or adapter (0) → name the actor (1) → find the extension point (2) → write
it plainly (3).

**Reviewing:** report only findings that would change the code, as

```
<file>:<line> — <principle>: <problem> → <change>
```

ordered by impact: core/adapter breach, rule or fact duplicated, adapter deciding, mechanism
edited per case, readability. Note deliberate closed sets and one-case abstractions you advise
against. Out-of-scope refactors are follow-ups.
