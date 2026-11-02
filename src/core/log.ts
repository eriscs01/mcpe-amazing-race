// One logger for the whole add-on (debuggability skill): a fixed event name, then key=value
// fields, always keyed by the race clock, so a host's report can be matched to log lines.
export type Level = 'info' | 'warn' | 'error';
export type Sink = (level: Level, line: string) => void;
export type Fields = Record<string, string | number | boolean | undefined>;

const PREFIX = '[race]';

function formatValue(value: string | number | boolean): string {
  const text = String(value);
  return /[\s="]/.test(text) ? JSON.stringify(text) : text;
}

export class Logger {
  constructor(
    private readonly sink: Sink,
    private readonly context: () => Fields,
  ) {}

  info(event: string, fields?: Fields): void {
    this.sink('info', this.format(event, fields));
  }

  warn(event: string, fields?: Fields): void {
    this.sink('warn', this.format(event, fields));
  }

  error(event: string, err: unknown, fields?: Fields): void {
    const message = err instanceof Error ? err.message : String(err);
    const line = this.format(event, { ...fields, error: message });
    const stack = err instanceof Error ? err.stack : undefined;
    this.sink('error', stack ? `${line}\n${stack}` : line);
  }

  private format(event: string, fields: Fields = {}): string {
    const pairs = Object.entries({ ...this.context(), ...fields })
      .filter((kv): kv is [string, string | number | boolean] => kv[1] !== undefined)
      .map(([k, v]) => `${k}=${formatValue(v)}`);
    return [PREFIX, event, ...pairs].join(' ');
  }
}

/**
 * Wraps an event handler, interval, job or form callback so a failure is logged with its key
 * and never stops the add-on. Async handlers' rejections are caught the same way.
 */
export function guard<A extends unknown[]>(
  log: Logger,
  handler: string,
  fn: (...args: A) => unknown,
): (...args: A) => void {
  const fail = (err: unknown): void => log.error('handlerFailed', err, { handler });
  return (...args: A): void => {
    try {
      const out = fn(...args);
      if (out instanceof Promise) out.catch(fail);
    } catch (err) {
      fail(err);
    }
  };
}
