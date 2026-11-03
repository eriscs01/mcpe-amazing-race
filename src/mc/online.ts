// The online player behind a persisted id, if any.
import { Player, world } from '@minecraft/server';

import type { PlayerId } from '../core/types.js';

export function online(id: PlayerId): Player | undefined {
  const entity = world.getEntity(id);
  return entity instanceof Player ? entity : undefined;
}
