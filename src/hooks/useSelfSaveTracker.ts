import { useCallback, useRef } from "react";

/**
 * Counts the app's own writes to each path. Every write to an open document is
 * marked here: a disk reload compares the count to tell that a write landed
 * while it was reading.
 */
export function useSelfSaveTracker() {
  const counts = useRef<Map<string, number>>(new Map());

  const selfSaveCount = useCallback((path: string) => counts.current.get(path) ?? 0, []);

  const markSelfSave = useCallback(
    (path: string) => {
      counts.current.set(path, selfSaveCount(path) + 1);
    },
    [selfSaveCount],
  );

  return { markSelfSave, selfSaveCount };
}
