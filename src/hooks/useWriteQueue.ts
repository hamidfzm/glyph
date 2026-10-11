import { useCallback, useRef } from "react";

export type EnqueueWrite = <T>(path: string, write: () => Promise<T>) => Promise<T>;

/**
 * Per-path write queue: writes to one file run one at a time, in the order they
 * were asked for, so an older write can never land on disk after a newer one.
 * Different paths do not wait on each other.
 */
export function useWriteQueue(): EnqueueWrite {
  const chains = useRef<Map<string, Promise<unknown>>>(new Map());

  return useCallback(<T>(path: string, write: () => Promise<T>): Promise<T> => {
    const previous = chains.current.get(path) ?? Promise.resolve();
    const run = previous.then(write);
    // Keep the chain intact even if this write threw, so ordering holds.
    chains.current.set(
      path,
      run.catch(() => {}),
    );
    return run;
  }, []);
}
