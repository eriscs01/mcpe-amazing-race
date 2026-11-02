# Minecraft Bedrock: Amazing Race

A behavior-pack add-on that plays *The Amazing Race* in a dedicated world: teams, one host, automatic challenge verification. Spec: [docs/amazing-race-addon-spec.md](docs/amazing-race-addon-spec.md) · Technical design: [docs/technical-design.md](docs/technical-design.md).

## Install and play

1. Download `AmazingRace-vX.Y.Z.mcaddon` from the [releases](https://github.com/eriscs01/mcpe-amazing-race/releases) and open it; Minecraft imports the behavior pack.
2. Make a **copy of the world** to race in (world settings → Copy World). Arenas stay in the world afterwards.
3. Activate **Amazing Race** under the copy's behavior packs. Requires Bedrock 1.21.90 or newer; no experiments.
4. The first player to join becomes host and gets the Race Control clock.

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
