import { useEffect, useRef } from "react";

const AUTO_SAVE_DELAY = 2000;

/** A dirty editable tab awaiting an autosave, identified so each document keeps
 *  its own debounce timer independent of which tab is active. */
export interface SavableDocument {
  id: string;
  /** Monotonic edit counter; a fresh value means new edits to (re)schedule. */
  revision: number;
}

interface UseAutoSaveOptions {
  /** Every currently-dirty editable tab, not just the active one. */
  documents: SavableDocument[];
  /** Persist one document by id (revision-guarded and serialized upstream). */
  save: (id: string) => void;
}

/**
 * Per-document debounced autosave. Each dirty tab owns its own timer, so
 * switching tabs never cancels another document's pending save. A save fires
 * once per revision: a new edit bumps the revision and reschedules; a completed
 * or failed save leaves the revision recorded, so it won't re-fire until the
 * next edit (retry-on-edit rather than a tight retry loop).
 */
export function useAutoSave({ documents, save }: UseAutoSaveOptions) {
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const scheduled = useRef<Map<string, number>>(new Map());
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    const live = new Set(documents.map((d) => d.id));
    // Drop timers for tabs that are no longer dirty or have closed.
    for (const [id, timer] of timers.current) {
      if (!live.has(id)) {
        clearTimeout(timer);
        timers.current.delete(id);
      }
    }
    for (const id of scheduled.current.keys()) {
      if (!live.has(id)) scheduled.current.delete(id);
    }
    // (Re)schedule a debounce whenever a document's revision advances.
    for (const doc of documents) {
      if (scheduled.current.get(doc.id) === doc.revision) continue;
      scheduled.current.set(doc.id, doc.revision);
      const existing = timers.current.get(doc.id);
      if (existing) clearTimeout(existing);
      timers.current.set(
        doc.id,
        setTimeout(() => {
          timers.current.delete(doc.id);
          saveRef.current(doc.id);
        }, AUTO_SAVE_DELAY),
      );
    }
  }, [documents]);

  // Clear every pending timer on unmount so none fire into a dead tree.
  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const timer of map.values()) clearTimeout(timer);
      map.clear();
    };
  }, []);
}
