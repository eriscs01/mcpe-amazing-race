// Removes the paths it is given (`node scripts/clean.mjs build/test dist`), like `rm -rf` but for
// every platform; the npm scripts use it so contributors on Windows can run them too.
import { rmSync } from 'node:fs';

process.argv.slice(2).forEach((path) => rmSync(path, { recursive: true, force: true }));
