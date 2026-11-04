// The playable task kinds. A kind a later group adds is one more entry here; a stop whose kind is
// not here still says it comes later.
import { archery } from './archery.js';
import { gather } from './gather.js';
import { haystack } from './haystack.js';
import { hunt } from './hunt.js';
import { parkour } from './parkour.js';
import { quiz } from './quiz.js';
import { recall } from './recall.js';

import type { TaskKindName } from '../config.js';
import type { TaskKind } from './kind.js';

const KINDS: Partial<Record<TaskKindName, TaskKind>> = {
  archery, parkour, haystack, hunt, gather, quiz, recall,
};

export const kindOf = (name: TaskKindName): TaskKind | undefined => KINDS[name];
