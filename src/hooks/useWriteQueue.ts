import { useCallback, useMemo, useRef } from "react";

export type EnqueueWrite = <T>(path: string, write: () => Promise<T>) => Promise<T>;

export interface WriteQueue {
  enqueueWrite: EnqueueWrite;
  /** Resolves once every write asked for so far has finished, failed ones included. */
  writesSettled: () => Promise<void>;
}

/**
 * Per-path write queue: writes to one file run one at a time, in the order they
 * were asked for, so an older write can never land on disk after a newer one.
 * Different paths do not wait on each other.
 */
export function useWriteQueue(): WriteQueue {
  const chains = useRef<Map<string, Promise<unknown>>>(new Map());

  const enqueueWrite = useCallback(<T>(path: string, write: () => Promise<T>): Promise<T> => {
    const previous = chains.current.get(path) ?? Promise.resolve();
    const run = previous.then(write);
    // Keep the chain intact even if this write threw, so ordering holds.
    chains.current.set(
      path,
      run.catch(() => {}),
    );
    return run;
  }, []);

  const writesSettled = useCallback(async () => {
    await Promise.all(chains.current.values());
  }, []);

  return useMemo(() => ({ enqueueWrite, writesSettled }), [enqueueWrite, writesSettled]);
}
