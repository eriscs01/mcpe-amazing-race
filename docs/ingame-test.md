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

- [ ] Pack loads with no Content Log errors; "Amazing Race loaded" appears.
- [ ] Forms open (host menu, Passport).
- [ ] HUD direction matches facing.

### M2–M4

Add checks as the groups land.
