# Minecraft Bedrock: Amazing Race

A behavior-pack add-on that plays *The Amazing Race* in a dedicated world: teams, one host, automatic challenge verification. Spec: [docs/amazing-race-addon-spec.md](docs/amazing-race-addon-spec.md) · Technical design: [docs/technical-design.md](docs/technical-design.md).

## Install and play

1. Download `AmazingRace-vX.Y.Z.mcaddon` from the [releases](https://github.com/eriscs01/mcpe-amazing-race/releases) and open it; Minecraft imports the behavior pack.
2. Make a **copy of the world** to race in (world settings → Copy World). Arenas stay in the world afterwards.
3. Activate **Amazing Race** under the copy's behavior packs. Requires Bedrock 1.21.90 or newer; no experiments.
4. The first player to join becomes host and gets the Race Control clock.

## Hosting a race

The host runs everything from the **Race Control** clock (right-click it); every racer carries a **Race Passport** (team, phase and advantages). Nothing needs commands or chat.

1. **Setup**: days (1–5), minutes per day, players per team, whether the host races, and the daylight cycle. The screen shows the legs, eliminations and course radius it derives from them.
2. **Teams**: *Auto-assign* shuffles everyone online into teams; *Swap two players* adjusts.
3. Stand at the start line and choose **Generate course here**. Optionally stand at a landmark first and choose **Add landmark here** to make it a stop. Arenas are built automatically (**Build arenas** retries any that failed); **List stops** shows the course.
4. **Start race**. A 10-second countdown locks everyone at the start, then each team follows its clue to the next stop.
5. Teams use the clue box at each stop, do the Detour or Roadblock it offers, then check in on the Pit Stop mat. The last team to check in plays a Speed Bump next leg, or is eliminated on the legs the plan marks.
6. A session can span several days: **End day** (also automatic once the day's legs are done) saves everything, and **Resume day** continues where each team stood. **Pause** and **Unpause** freeze the clock, the racers and the daylight.
7. **Team fixes** (add a penalty, skip a step, eliminate, teleport to a team) and **Status** help when something goes wrong. **End leg now** closes a leg early.
8. **End race** restores the world's rules and time of day and releases the players; the arenas stay in the world copy.

If the world closes mid-race the race comes back **paused**; the host unpauses it once the racers are back.

## Develop

```bash
npm install
npm run typecheck   # type-check against @minecraft/server 2.0.0
npm run build       # compile src/ -> behavior_pack/scripts/
npm test            # core unit tests (Node >= 22)
npm run lint        # ESLint: Airbnb style (rules + formatting) + Minecraft lint
npm run format      # auto-fix what ESLint can (formatting included)
npm run coverage    # tests + coverage; fails below 80% lines of src/core
npm run package     # clean build + checks -> dist/AmazingRace.mcaddon
```

Targets stable `@minecraft/server` / `@minecraft/server-ui` 2.0.0 only; no Beta APIs, no resource pack.

In-game checks: [docs/ingame-test.md](docs/ingame-test.md).

## Release

Bump `version` in `package.json` and every version in `behavior_pack/manifest.json`, add a `CHANGELOG.md` section, then push a tag `vX.Y.Z`. The release workflow verifies, packages and publishes the `.mcaddon`.

## License

GPL-3.0-or-later, see [LICENSE](LICENSE).
