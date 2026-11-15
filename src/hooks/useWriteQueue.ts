import { useCallback, useMemo, useRef } from "react";
import { isPathInside } from "@/lib/paths";

export type EnqueueWrite = <T>(path: string, write: () => Promise<T>) => Promise<T>;
export type EnqueueRelocation = <T>(path: string, relocate: () => Promise<T>) => Promise<T>;

export interface WriteQueue {
  enqueueWrite: EnqueueWrite;
  enqueueRelocation: EnqueueRelocation;
  /** Resolves once every write asked for so far has finished, failed ones included. */
  writesSettled: () => Promise<void>;
}

interface Relocation {
  path: string;
  done: Promise<unknown>;
}

/**
 * Per-path write queue: writes to one file run one at a time, in the order they
 * were asked for, so an older write can never land on disk after a newer one.
 * Different paths do not wait on each other. A rename or move takes a turn in
 * the queue of every path it moves, so no write of those paths runs while the
 * file moves and its tabs follow.
 */
export function useWriteQueue(): WriteQueue {
  const chains = useRef<Map<string, Promise<unknown>>>(new Map());
  const relocations = useRef<Set<Relocation>>(new Set());

  const enqueueWrite = useCallback(<T>(path: string, write: () => Promise<T>): Promise<T> => {
    const turns = [chains.current.get(path) ?? Promise.resolve()];
    // A relocation also holds the paths it found no write of when it began.
    for (const relocation of relocations.current) {
      if (isPathInside(path, relocation.path)) turns.push(relocation.done);
    }
    const run = Promise.all(turns).then(write);
    // Keep the chain intact even if this write threw, so ordering holds.
    chains.current.set(
      path,
      run.catch(() => {}),
    );
    return run;
  }, []);

  const enqueueRelocation = useCallback(
    <T>(path: string, relocate: () => Promise<T>): Promise<T> => {
      const turns = [...chains.current]
        .filter(([written]) => isPathInside(written, path))
        .map(([, chain]) => chain);
      for (const relocation of relocations.current) {
        const overlaps = isPathInside(path, relocation.path) || isPathInside(relocation.path, path);
        if (overlaps) turns.push(relocation.done);
      }
      const run = Promise.all(turns).then(relocate);
      const relocation = { path, done: run.catch(() => {}) };
      relocations.current.add(relocation);
      relocation.done.then(() => relocations.current.delete(relocation));
      return run;
    },
    [],
  );

  const writesSettled = useCallback(async () => {
    await Promise.all(chains.current.values());
  }, []);

  return useMemo(
    () => ({ enqueueWrite, enqueueRelocation, writesSettled }),
    [enqueueWrite, enqueueRelocation, writesSettled],
  );
}
