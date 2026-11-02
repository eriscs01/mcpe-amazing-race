// World dynamic properties as the core's PropertyBag; all chunking and validation is in core.
import { world } from '@minecraft/server';

import type { PropertyBag } from '../core/persist.js';

export const worldBag: PropertyBag = {
  get: (key) => world.getDynamicProperty(key),
  set: (key, value) => world.setDynamicProperty(key, value),
};
