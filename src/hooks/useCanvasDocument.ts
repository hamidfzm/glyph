import { useCallback, useEffect, useRef, useState } from "react";
import { parseCanvas } from "@/lib/canvas/parse";
import { serializeCanvas } from "@/lib/canvas/serialize";
import type { CanvasData } from "@/lib/canvas/types";

function safeParse(content: string): CanvasData {
  try {
    return parseCanvas(content);
  } catch {
    return { nodes: [], edges: [] };
  }
}

interface UseCanvasDocument {
  data: CanvasData;
  /** Update the working board WITHOUT persisting — for live drag/resize frames. */
  setData: (next: CanvasData) => void;
  /** Persist a finished edit: serialize and push the JSON upstream (autosave + undo history). */
  commit: (next: CanvasData) => void;
}

/**
 * Bridges the canvas board to the tab's text-content pipeline. The board is
 * edited as a `CanvasData`, but persistence, autosave, and undo/redo all work
 * on the serialized JSON string (exactly like the markdown editor's text). We
 * re-parse `content` only when it changes from the OUTSIDE (undo/redo or an
 * external file reload) — our own commits set `lastSerialized` first so the
 * echo of `content` updating to our output doesn't clobber local state mid-edit.
 */
export function useCanvasDocument(
  content: string,
  onCommit: (serialized: string) => void,
): UseCanvasDocument {
  const [data, setData] = useState<CanvasData>(() => safeParse(content));
  const lastSerialized = useRef<string>(content);

  useEffect(() => {
    if (content !== lastSerialized.current) {
      lastSerialized.current = content;
      setData(safeParse(content));
    }
  }, [content]);

  const commit = useCallback(
    (next: CanvasData) => {
      const serialized = serializeCanvas(next);
      lastSerialized.current = serialized;
      setData(next);
      onCommit(serialized);
    },
    [onCommit],
  );

  return { data, setData, commit };
}
