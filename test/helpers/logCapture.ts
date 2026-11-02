// Collects logger output so tests can assert on log lines.
import type { Level } from '../../src/core/log.js';

export class LogCapture {
  readonly lines: { level: Level; line: string }[] = [];

  readonly sink = (level: Level, line: string): void => {
    this.lines.push({ level, line });
  };

  /** Lines whose event name (first word after the prefix) is `event`. */
  find(event: string): { level: Level; line: string }[] {
    return this.lines.filter((l) => l.line.split(' ')[1] === event);
  }
}
