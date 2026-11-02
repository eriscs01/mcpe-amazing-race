// Prints the CHANGELOG.md section for one version (used by the release workflow).
import { readFileSync } from "node:fs";

const version = process.argv[2];
const lines = readFileSync("CHANGELOG.md", "utf8").split("\n");
const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
if (!version || start < 0) {
  console.error(`release-notes: no "## [${version}]" section in CHANGELOG.md`);
  process.exit(1);
}
const end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
console.log(lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim());
