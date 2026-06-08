import type { Disposer } from "./disposer";

/**
 * A live, ordered collection that plugins contribute to and the app reads from.
 * `register` adds an entry and returns a {@link Disposer} that removes it;
 * UI that renders the entries calls `subscribe` to re-read when the set
 * changes. This is the single primitive behind every contribution point
 * (commands, sidebar panels, status bar items, exporters, markdown plugins),
 * so registration/teardown semantics live in exactly one place.
 */
export interface Registry<T> {
  /** Add an entry; the returned disposer removes it. */
  register(entry: T): Disposer;
  /** Snapshot of the current entries, in insertion order. */
  list(): readonly T[];
  /** Observe changes; the returned disposer unsubscribes. */
  subscribe(listener: () => void): Disposer;
}

export function createRegistry<T>(): Registry<T> {
  const entries = new Set<T>();
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) listener();
  };

  return {
    register(entry) {
      entries.add(entry);
      notify();
      return () => {
        if (entries.delete(entry)) notify();
      };
    },
    list() {
      return [...entries];
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
