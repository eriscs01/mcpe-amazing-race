# Minecraft Bedrock: Amazing Race

A behavior-pack add-on that plays *The Amazing Race* in a dedicated world: teams, one host, automatic challenge verification. Spec: [docs/amazing-race-addon-spec.md](docs/amazing-race-addon-spec.md) · Technical design: [docs/technical-design.md](docs/technical-design.md).

## Develop

```bash
npm install
npm run typecheck   # type-check against @minecraft/server 2.0.0
npm run build       # compile src/ -> behavior_pack/scripts/
npm run package     # dist/AmazingRace.mcaddon
```

Targets stable `@minecraft/server` / `@minecraft/server-ui` 2.0.0 only; no Beta APIs, no resource pack.

## License

GPL-3.0-or-later, see [LICENSE](LICENSE).
