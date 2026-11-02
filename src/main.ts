import { world } from '@minecraft/server';

// No world access at module top level (Script API 2.0): initialise in worldLoad.
world.afterEvents.worldLoad.subscribe(() => {
  console.warn('Amazing Race loaded');
});
