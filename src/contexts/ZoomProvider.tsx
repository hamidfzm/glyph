import { type ReactNode, useMemo, useRef, useState } from "react";
import { TAB_ZOOM_DEFAULT } from "@/lib/tabZoom";
import { type ZoomApi, ZoomApiContext, type ZoomHandlers, ZoomStateContext } from "./ZoomContext";

// Holds the temporary, per-tab zoom for the document area: a font multiplier per
// note tab (survives tab switches, never written to settings) plus an imperative
// registration so the Zoom In/Out/Actual-Size commands reach whichever surface
// is active (note, graph). The multiplier map is keyed by tab id and never
// pruned (one float per opened tab is negligible and it clears on restart).
// ponytail: prune on tab close only if a session opens thousands.
export function ZoomProvider({ children }: { children: ReactNode }) {
  const [noteZoomByTab, setNoteZoomByTab] = useState<Record<string, number>>({});
  const targetRef = useRef<ZoomHandlers | null>(null);

  // Stable across renders (only referentially-stable setters/refs are closed
  // over), so API-only consumers don't re-render when a multiplier changes.
  const api = useMemo<ZoomApi>(
    () => ({
      setNoteZoom: (tabId, update) => {
        setNoteZoomByTab((prev) => {
          const current = prev[tabId] ?? TAB_ZOOM_DEFAULT;
          const next = update(current);
          if (next === current) return prev;
          return { ...prev, [tabId]: next };
        });
      },
      registerTarget: (handlers) => {
        targetRef.current = handlers;
      },
      actions: {
        zoomIn: () => targetRef.current?.zoomIn(),
        zoomOut: () => targetRef.current?.zoomOut(),
        zoomReset: () => targetRef.current?.zoomReset(),
      },
    }),
    [],
  );

  return (
    <ZoomApiContext.Provider value={api}>
      <ZoomStateContext.Provider value={noteZoomByTab}>{children}</ZoomStateContext.Provider>
    </ZoomApiContext.Provider>
  );
}
