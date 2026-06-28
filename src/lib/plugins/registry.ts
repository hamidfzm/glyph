import type { Disposer } from "./disposer";

/**
 * A live, ordered collection that plugins contribute to and the app reads from.
 * `register` adds an entry and returns a {@link Disposer} that removes it;
 * UI that renders the entries calls `subscribe` to re-read when the set
 * changes. This is the single primitive behind every contribution point
 * (commands, status bar items, and later panels/exporters/markdown), so
 * registration/teardown semantics live in exactly one place.
 */
export interface Registry<T> {
  /** Add an entry; the returned disposer removes it. */
  register(entry: T): Disposer;
  /**
   * Current entries in insertion order. The same array reference is returned
   * until the registry changes, so it is safe as a `useSyncExternalStore`
   * snapshot.
   */
  list(): readonly T[];
  /** Observe changes; the returned disposer unsubscribes. */
  subscribe(listener: () => void): Disposer;
}

export function createRegistry<T>(): Registry<T> {
  const entries = new Set<T>();
  const listeners = new Set<() => void>();
  let snapshot: readonly T[] = [];

  const notify = () => {
    snapshot = [...entries];
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
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
