import { useCallback, useRef } from "react";

// How long after our own write a `file-changed` event for that path is treated
// as an echo of the save rather than an external edit. Re-syncing identical
// content into the editor would dismiss any active autocomplete popup.
const SELF_SAVE_GRACE_MS = 1500;

interface SelfSaves {
  lastAt: number;
  count: number;
}

/**
 * Remembers when each path was last written by the app itself, and how often.
 * Every write to an open document is marked here: a disk reload compares the
 * count to tell that a save overtook its read.
 */
export function useSelfSaveTracker() {
  const saves = useRef<Map<string, SelfSaves>>(new Map());

  const selfSaveCount = useCallback((path: string) => saves.current.get(path)?.count ?? 0, []);

  const markSelfSave = useCallback(
    (path: string) => {
      saves.current.set(path, { lastAt: Date.now(), count: selfSaveCount(path) + 1 });
    },
    [selfSaveCount],
  );

  const isRecentSelfSave = useCallback((path: string) => {
    const last = saves.current.get(path);
    return last !== undefined && Date.now() - last.lastAt < SELF_SAVE_GRACE_MS;
  }, []);

  return { markSelfSave, isRecentSelfSave, selfSaveCount };
}
