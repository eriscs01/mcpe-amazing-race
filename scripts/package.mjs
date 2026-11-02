// Builds dist/AmazingRace.mcaddon: a zip holding the behavior pack as one folder
// (requires the system `zip`).
// Fails before zipping if the pack is incomplete or its version disagrees with package.json.
import { execFileSync } from 'node:child_process';
import {
  cpSync, existsSync, mkdirSync, readFileSync, rmSync,
} from 'node:fs';
import { resolve } from 'node:path';

const PACK_DIR = 'AmazingRace_BP';
const fail = (msg) => {
  console.error(`package: ${msg}`);
  process.exit(1);
};

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const manifest = JSON.parse(readFileSync('behavior_pack/manifest.json', 'utf8'));

const { version } = pkg;
const versions = [manifest.header.version, ...manifest.modules.map((m) => m.version)]
  .map((v) => v.join('.'));
if (versions.some((v) => v !== version)) {
  fail(
    `manifest header/module versions (${versions.join(', ')}) `
      + `must all equal package.json version ${version}`,
  );
}
const script = manifest.modules.find((m) => m.type === 'script');
for (const file of ['pack_icon.png', script?.entry]) {
  if (!file || !existsSync(`behavior_pack/${file}`)) {
    fail(`behavior_pack/${file ?? '<script entry>'} is missing (run npm run build)`);
  }
}

const stage = resolve('build/package');
const out = resolve('dist/AmazingRace.mcaddon');
rmSync(stage, { recursive: true, force: true });
cpSync('behavior_pack', `${stage}/${PACK_DIR}`, { recursive: true });
mkdirSync('dist', { recursive: true });
rmSync(out, { force: true });
execFileSync('zip', ['-r', '-q', '-X', out, PACK_DIR], { cwd: stage, stdio: 'inherit' });
console.log(`Wrote ${out} (v${version})`);
