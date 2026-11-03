// Entry point: wiring only. Event subscriptions live at top level; world access starts in
// worldLoad (Script API 2.0 forbids it earlier). Handlers ignore events until state is loaded.
import { system, world } from '@minecraft/server';

import { guard } from './core/log.js';
import { Session } from './core/session.js';
import { startArenaBuild } from './mc/builder.js';
import { startGenerationJob } from './mc/generationJob.js';
import { lightStops } from './mc/lighting.js';
import { startLoop } from './mc/loop.js';
import { worldBag } from './mc/store.js';
import { greetOnlinePlayers, wireEvents } from './mc/wiring.js';
import { executeEffects } from './mc/world.js';

import type { Level } from './core/log.js';

// Content Log shows warnings and errors; outcome (info) lines go to it as warnings.
const sink = (level: Level, line: string): void => {
  if (level === 'error') console.error(line);
  else console.warn(line);
};

const session: Session = new Session({
  bag: worldBag,
  sink,
  execute: (effects) => executeEffects(effects, session.log, {
    generate: guard(
      session.log,
      'generationJob',
      async (effect) => startGenerationJob(session, effect),
    ),
    build: guard(
      session.log,
      'arenaBuild',
      async (effect) => startArenaBuild(session, effect),
    ),
    light: guard(session.log, 'lightStops', (effect) => lightStops(session, effect)),
    // Next tick: the failure arrives while the effect that failed is still being applied.
    zoneFailed: (stop, zone) => system.run(() => {
      session.dispatch({ type: 'zoneBuildFailed', stop, zone });
    }),
  }),
  newSeed: () => Math.floor(Math.random() * 2 ** 32),
});

wireEvents(session);

world.afterEvents.worldLoad.subscribe(guard(session.log, 'worldLoad', () => {
  session.load();
  greetOnlinePlayers(session);
  startLoop(session);
}));
