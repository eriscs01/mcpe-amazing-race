// Zips behavior_pack/ into dist/AmazingRace.mcaddon (requires the system `zip`).
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const out = resolve("dist/AmazingRace.mcaddon");
mkdirSync("dist", { recursive: true });
rmSync(out, { force: true });
execFileSync("zip", ["-r", "-q", out, "."], { cwd: "behavior_pack", stdio: "inherit" });
console.log(`Wrote ${out}`);
