// Every vanilla identifier the add-on writes must exist in the oldest supported game
// (vanilla-data 1.21.90, matching min_engine_version) and in the latest data we know of.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as latest from "@minecraft/vanilla-data";
import * as oldest from "vanilla-data-min";
import * as config from "../src/core/config.js";
import { BLOCK, ENTITY, ITEM } from "../src/core/config.js";

type Data = typeof latest;
const categories = [
  { name: "BLOCK", ids: BLOCK, enumOf: (d: Data) => d.MinecraftBlockTypes },
  { name: "ITEM", ids: ITEM, enumOf: (d: Data) => d.MinecraftItemTypes },
  { name: "ENTITY", ids: ENTITY, enumOf: (d: Data) => d.MinecraftEntityTypes },
] as const;

for (const { name, ids, enumOf } of categories) {
  test(`every ${name} id exists in vanilla-data 1.21.90 and latest`, () => {
    const known = [oldest as unknown as Data, latest].map((d) => new Set<string>(Object.values(enumOf(d))));
    const missing = Object.entries(ids)
      .filter(([, id]) => !known.every((set) => set.has(id)))
      .map(([key, id]) => `${name}.${key} = ${id}`);
    assert.deepEqual(missing, []);
  });
}

test("config uses no vanilla id outside the checked id tables", () => {
  const registered = new Set<string>(categories.flatMap((c) => Object.values(c.ids)));
  const found = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === "string") {
      if (v.startsWith("minecraft:")) found.add(v);
    } else if (v && typeof v === "object") {
      for (const x of Object.values(v)) walk(x);
    }
  };
  walk(config);
  assert.deepEqual([...found].filter((id) => !registered.has(id)), []);
});
