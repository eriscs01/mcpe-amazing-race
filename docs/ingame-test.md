# In-game test checklist

Run on Bedrock 1.21.90 or newer with at least 2 players, in a copy of a world. Groups marked ✱ in
the technical design (§4) add their checks here and record the result in their PR.

## Setup

1. `npm run package`, then open `dist/AmazingRace.mcaddon` (or copy `AmazingRace_BP/` into
   `development_behavior_packs/` for quick iteration).
2. Create a world copy, activate the **Amazing Race** behavior pack. No experiments are needed.
3. Open **Settings → Creator** and enable the Content Log so script errors are visible.

## Verify first (spec §3, §14; technical design §1)

| Check | Result (version, date) |
|---|---|
| `itemUse` fires when right-clicking a Clock in the air | |
| `itemUse` fires when right-clicking a Compass in the air | |
| Beacon beam shows through the cleared column on a built arena | |
| `projectileHitBlock` reports the player as source for player-shot arrows | |
| Team-coloured `nameTag` is visible to other players | |
| Ticking-area load latency stays within the 30 s generation timeout | |

## Per milestone

### M1 — walking skeleton (G1–G8)

- [ ] Pack loads with no Content Log errors; `[race] loaded … version=<pkg> schema=1 source=new` appears.
- [ ] Reopening the world logs `source=saved` with the same `seed` (state persisted).
- [ ] Closing the world while the race runs, then reopening it, logs `pausedOnLoad`.
- [ ] Forms open (host menu, Passport).
- [ ] First player to join a fresh world gets Race Control and `hostChanged … via=playerSpawned` is logged.
- [ ] Race Control opens the host menu (in the air and on a block; one menu, block not opened);
      it shows `Phase: Setup` and **Transfer host**.
- [ ] A non-host using Race Control is told who the host is; sneak-using a plain clock is refused.
- [ ] Host sneak-uses a plain clock: the old Race Control is replaced by a fresh one.
- [ ] Transfer host to the second player: the item moves, both get a message.
- [ ] `/scriptevent race:host` makes the sender host; `/scriptevent race:dump` logs `stateDump`.
- [ ] Race Control is kept on death and cannot be dropped.
- [ ] Opening the host menu with chat open shows it once chat closes (UserBusy retry).
- [ ] With a corrupted save (`race:n` set to a bad value), Race Control shows
      "Saved race unreadable — see Content Log".
- [ ] HUD direction matches facing.

### M2–M4

Add checks as the groups land.
