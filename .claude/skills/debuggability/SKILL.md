---
name: debuggability
description: Keep the add-on easy to diagnose from what a host can report ("Team Red's clue box did nothing on leg 3") using the content log, a state dump and the race clock. Use when adding or changing an event handler, a form, a periodic system, a world write, course generation, persistence, an error path, a refusal, a retry or anything that can fail at run time; when touching logging or error handling; when reviewing a change for operability; or when the user asks about logging, debugging, the content log or troubleshooting a race.
---

# Debuggability: diagnose a race problem from one report

When something goes wrong mid-race, the developer usually gets a host's sentence and maybe a
copy of the world. There is no debugger, no network log and a race that cannot be replayed
cheaply. Every change must leave enough behind that, from the **team, leg, step and race clock
tick**, someone can find what was asked, what the add-on decided, what it refused or how it
failed, and what it changed — from the Content Log and a state dump alone.

The project's own rules come first: `CLAUDE.md`, the spec and `docs/technical-design.md`.

## 1. One correlation key, everywhere

- **The race clock tick is the timestamp.** Every log line carries `clock`, plus whichever of
  `team`, `player` (id, not only name), `leg`, `stop` and `step` apply. Format the prefix once
  in a shared logger (`log.info(event, fields)`), never by hand per call.
- **Players are identified by `player.id`**, matching persisted state; names are added for
  readability only.
- **Deferred work keeps its key.** Work moved to `system.run`, `runJob` or a form callback
  logs with the same team/stop as the event that started it.
- **Players see a reason.** Every refusal shown to a player ("Not your clue box", "All
  teammates must be present", "Locked out for 10 s") has a stable code that also appears in
  the log line.

## 2. Say what happened, as fields

- **One line per outcome** at the points that change the race: clue box used, step advanced,
  task completed, check-in, placement, elimination, penalty added, advantage used, leg/day
  start/end, generation stop accepted/rejected (with reason), save failure.
- **Fixed message, variable fields:** `[race] stepAdvanced clock=48210 team=red leg=3 step=2`
  — searchable, never a free-form sentence with values interpolated.
- **Levels:** `console.info` for normal outcomes (guard with a debug toggle if chatty),
  `console.warn` for refusals and recoverable conditions, `console.error` for unexpected
  failures with the error's stack. Tell the host to enable **Content Log** (Settings → Creator)
  to see them.
- **Name the build.** On `worldLoad`, log the add-on version from the manifest and the
  persisted state schema version.
- **Nothing per tick.** Periodic systems (HUD, trail, sweeps) never log every run; they log
  state changes only, so the log stays readable.

## 3. Never lose an error

- **Every subscribed handler, interval and job is wrapped** in one `guard(name, fn)` that
  catches, logs `console.error` with the name and correlation fields, and keeps the add-on
  running. An exception must never silently kill the tick loop.
- **No empty catches.** Expected world conditions — `LocationInUnloadedChunkError`, an
  `undefined` block, an offline player, `UserBusy` on a form, a ticking-area command with
  `successCount` 0 — are handled explicitly and, when they change an outcome, logged once at
  warn (not per retry).
- **Promises are awaited or guarded** (form `show()`, async generation). An unhandled rejection
  is a bug.
- **Persistence failures are loud.** A failed load (bad JSON, missing chunk) logs the chunk key
  and count, keeps the raw strings untouched and puts the race in a safe paused phase rather
  than overwriting state with defaults.
- **Watchdog-safe.** Long work (generation, arena builds) yields via `waitTicks`/`runJob` so
  the script watchdog never terminates the add-on mid-write.

## 4. Log nothing sensitive or spoiling

- Log ids, codes, counts, positions and durations. Do not echo chat text or quiz answers a
  player typed; log `correct=false` instead.
- **Public output never spoils the course.** Chat broadcasts and the sidebar follow spec §10;
  exact targets and future stops appear only in the log, the host's screens and the owning
  team's HUD.

## 5. Leave the host and the developer a path

- **State dump:** `/scriptevent race:debug` (operators, optional) writes a compact summary
  (phase, clock, leg, each team's leg/step/status/penalty) to the Content Log and the sender's
  chat; `race:debug full` dumps the JSON state in chunks. Read-only.
- **Host Status screen** shows the same per-team summary without the Content Log.
- **Troubleshooting notes** in `docs/` for each new failure mode: what the host sees, which log
  line to search for, what to do (Team fixes: Skip, Teleport, Add penalty), how to confirm.
- **Reproducible courses.** The RNG seed is persisted and logged, so a course or quiz draw can
  be regenerated in a test.

## How to use this skill

**When writing code:** for each handler, form, system or job you add or change, answer: which
correlation fields does it log, what line does it leave on success, refusal and failure, at
which level, and how does a host recover? Prove log lines in tests by capturing the logger's
output (the core logger takes an injected sink).

**When reviewing:** report only findings that would change the code, tests or docs, each as

```
<file>:<line> — <gap>: <what could not be diagnosed or what leaks> → <change>
```

ordered by impact: an unguarded handler or swallowed error first, then a state-loss path in
persistence, then a refusal with no code or log line, then missing correlation fields, then a
spoiler or per-tick log spam, then message style.
