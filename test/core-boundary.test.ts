import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// Compiled to build/test/test/, so the repo root is three levels up.
const root = fileURLToPath(new URL("../../../", import.meta.url));
const coreDir = join(root, "src", "core");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sourceFiles(join(dir, e.name)) : /\.[mc]?ts$/.test(e.name) ? [join(dir, e.name)] : [],
  );
}

const specifiers = (src: string): string[] =>
  [...src.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["']([^"']+)["']/g)].map((m) => m[1]!);

test("src/core exists and has sources", () => {
  assert.ok(sourceFiles(coreDir).length > 0);
});

test("src/core never imports @minecraft/* or the adapter", () => {
  const breaches = sourceFiles(coreDir).flatMap((file) =>
    specifiers(readFileSync(file, "utf8"))
      .filter((s) => s.startsWith("@minecraft/") || /(^|\/)mc(\/|$)/.test(s) || s.endsWith("/main.js"))
      .map((s) => `${relative(root, file)} imports ${s}`),
  );
  assert.deepEqual(breaches, []);
});

test("the import scanner sees every import form", () => {
  const src = [
    `import { a } from "@minecraft/server";`,
    `import "@minecraft/x";`,
    `const m = await import('../mc/world.js');`,
    `export * from "./ok.js";`,
    `import type { T } from "@minecraft/server-ui";`,
    `export { b } from "../mc/items.js";`,
    `import {\n  c,\n  d,\n} from "@minecraft/common";`,
  ].join("\n");
  assert.deepEqual(specifiers(src), [
    "@minecraft/server", "@minecraft/x", "../mc/world.js", "./ok.js",
    "@minecraft/server-ui", "../mc/items.js", "@minecraft/common",
  ]);
});
