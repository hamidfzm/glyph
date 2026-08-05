import { useCallback, useRef } from "react";

// How long after our own write a `file-changed` event for that path is treated
// as an echo of the save rather than an external edit. Re-syncing identical
// content into the editor would dismiss any active autocomplete popup.
const SELF_SAVE_GRACE_MS = 1500;

/** Remembers when each path was last written by the app itself. */
export function useSelfSaveTracker() {
  const times = useRef<Map<string, number>>(new Map());

  const markSelfSave = useCallback((path: string) => {
    times.current.set(path, Date.now());
  }, []);

  const isRecentSelfSave = useCallback((path: string) => {
    const last = times.current.get(path);
    return last !== undefined && Date.now() - last < SELF_SAVE_GRACE_MS;
  }, []);

  return { markSelfSave, isRecentSelfSave };
}
