// The playable task kinds. A kind a later group adds (Hunt, Gather, Quiz, Recall) is one more
// entry here; until then its stop says it comes later.
import { archery } from './archery.js';
import { haystack } from './haystack.js';
import { parkour } from './parkour.js';

import type { TaskKindName } from '../config.js';
import type { TaskKind } from './kind.js';

const KINDS: Partial<Record<TaskKindName, TaskKind>> = { archery, parkour, haystack };

export const kindOf = (name: TaskKindName): TaskKind | undefined => KINDS[name];
