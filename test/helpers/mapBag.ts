// Stand-in for world dynamic properties.
import type { PropertyBag, PropertyValue } from '../../src/core/persist.js';

export class MapBag implements PropertyBag {
  readonly map = new Map<string, PropertyValue>();

  writes = 0;

  /** When set, every write throws this error (e.g. a full world save). */
  failWith: Error | undefined;

  get(key: string): unknown {
    return this.map.get(key);
  }

  set(key: string, value: PropertyValue | undefined): void {
    if (this.failWith) throw this.failWith;
    this.writes += 1;
    if (value === undefined) this.map.delete(key);
    else this.map.set(key, value);
  }
}
