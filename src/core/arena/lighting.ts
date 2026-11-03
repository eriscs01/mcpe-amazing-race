// Lighting changes wait until the stop's chunk is loaded (spec §6.6): a queue of the latest
// wish per stop, retried on a timer until the adapter manages to apply it.

interface Entry<T> {
  item: T;
  tries: number;
}

export class RetryQueue<T extends { id: number }> {
  private entries = new Map<number, Entry<T>>();

  /** Queues a change; a newer one for the same stop replaces it and starts counting afresh. */
  set(item: T): void {
    this.entries.set(item.id, { item, tries: 0 });
  }

  get size(): number {
    return this.entries.size;
  }

  pending(): T[] {
    return [...this.entries.values()].map((e) => e.item);
  }

  /**
   * One round: `apply` gets each item and its attempt number and returns whether it is done.
   * An item that is not done stays; one that throws is dropped and handed to `onError`, so one
   * bad entry cannot hold up the rest.
   */
  drain(
    apply: (item: T, tries: number) => boolean,
    onError: (item: T, error: unknown) => void,
  ): void {
    const round = [...this.entries.values()];
    round.forEach((entry) => {
      const current = entry;
      current.tries += 1;
      try {
        if (apply(current.item, current.tries) && this.entries.get(current.item.id) === current) {
          this.entries.delete(current.item.id);
        }
      } catch (error) {
        if (this.entries.get(current.item.id) === current) this.entries.delete(current.item.id);
        onError(current.item, error);
      }
    });
  }
}
