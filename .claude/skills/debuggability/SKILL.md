---
name: debuggability
description: Make run-time problems diagnosable from a host's report using structured logs, guarded handlers and recoverable state. Use when adding event handlers, forms, periodic systems, world writes, persistence or error paths, or when reviewing for operability.
---

# Debuggability

A race problem usually arrives as one sentence from the host ("Team Red's clue box did nothing
on leg 3"). There is no debugger and no cheap replay. Every change must leave enough in the
Content Log and the saved state to find what was asked, what the add-on decided, what it
refused or how it failed, and what it changed.

**Project specifics come from the project.** `CLAUDE.md` and the design documents it points to
name the logger, debug tools and log conventions. Where they are explicit, they win.

## 1. One correlation key

- Every log line carries the **race clock tick** plus whichever of team, player id, leg, stop
  and step apply. Format it once in a shared logger, not by hand per call.
- Identify players by `player.id`, as in saved state; names only for readability.
- Work deferred to a later tick, a job or a form callback keeps the key of the event that
  started it.
- Every refusal shown to a player has a stable code that also appears in the log.

## 2. Say what happened, as fields

- **One line per outcome** that changes the race (step advanced, task done, check-in,
  elimination, penalty, advantage used, leg or day boundary, generation accepted/rejected).
- **Fixed message, variable fields:** `stepAdvanced clock=48210 team=red leg=3 step=2`.
- **Levels:** info for outcomes (quiet by default if chatty), warn for refusals and recovered
  conditions, error with stack for unexpected failures.
- **Log the version** and state schema version on load.
- **Never log per tick.** Periodic systems log state changes only.

## 3. Never lose an error

- **Every event handler, interval, job and form callback runs inside one shared guard** that
  logs the error with its key and keeps the add-on running.
- **No empty catches.** Expected conditions (unloaded chunk, missing block, offline player,
  busy form, failed command) are handled explicitly and logged once when they change an
  outcome, not per retry.
- **Promises are awaited or guarded.**
- **Persistence failures never overwrite state.** Log what failed, keep the raw data, and stop
  in a safe paused state.
- **Long work yields** so the script watchdog never stops it mid-write.

## 4. Don't leak or spoil

- Log ids, codes, counts, positions and durations, never typed chat or quiz answers.
- Public output (chat, sidebar) never reveals future stops or another team's details; those
  belong only in logs, host screens and the owning team's HUD.

## 5. Leave a path

- The host can see each team's state in-game without the Content Log.
- A read-only way to dump state exists for diagnosing a saved world.
- Seeds are persisted and logged so generated content can be reproduced in a test.
- New failure modes get a short troubleshooting note: what the host sees, which log line to
  find, how to recover.

## How to use

**Writing:** for each handler, form, system or job, decide its key, its log line for success,
refusal and failure, and how the host recovers. Prove important lines with tests that capture
logger output.

**Reviewing:** report only findings that would change code, tests or docs, as

```
<file>:<line> — <gap>: <what can't be diagnosed or what leaks> → <change>
```

ordered by impact: unguarded handler or swallowed error, state-loss path, refusal without code
or log, missing key fields, spoiler or log spam, style.
