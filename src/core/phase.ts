// Race lifecycle. The host's menus offer only the moves allowed from the current phase.
import type { Phase } from './types.js';

const NEXT: Record<Phase, readonly Phase[]> = {
  setup: ['generating'],
  // Back to setup when generation is abandoned; generated stops are kept for a re-run.
  generating: ['ready', 'setup'],
  ready: ['generating', 'running'],
  running: ['paused', 'dayEnded', 'finished'],
  paused: ['running', 'dayEnded', 'finished'],
  dayEnded: ['running', 'finished'],
  finished: [],
};

export function canEnter(from: Phase, to: Phase): boolean {
  return NEXT[from].includes(to);
}
