import { createContext, useContext } from "react";

// Context + hooks for the temporary, per-tab zoom. Kept component-free so the
// provider file stays Fast-Refresh-eligible. The provider lives in
// `ZoomProvider.tsx`; the note-font layer, graph view, and status bar read this.
//
// Two contexts on purpose: the API (dispatch + register) is referentially
// stable, so consumers that only drive zoom (AppShell, GraphView) don't
// re-render when a multiplier changes; only the value's renderers (NoteZoomLayer,
// StatusBar) subscribe to the reactive map.

export interface ZoomHandlers {
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
}

export interface ZoomApi {
  /** Update one note tab's multiplier via an updater on its current value. */
  setNoteZoom: (tabId: string, update: (current: number) => number) => void;
  /** Register the active surface's zoom handlers, or null on unmount. The menu
   *  Zoom In/Out/Actual-Size commands dispatch to whatever is registered. */
  registerTarget: (handlers: ZoomHandlers | null) => void;
  /** Zoom actions forwarded to the registered surface (drive the menu/hotkeys). */
  actions: ZoomHandlers;
}

export const ZoomApiContext = createContext<ZoomApi | null>(null);
export const ZoomStateContext = createContext<Record<string, number> | null>(null);

/** The stable zoom API, or null when rendered outside a provider. */
export function useZoomApi(): ZoomApi | null {
  return useContext(ZoomApiContext);
}

/** The per-note-tab multiplier map (1 = the saved font size), or null outside a
 *  provider. Reactive: reading it subscribes to multiplier changes. */
export function useNoteZoomMap(): Record<string, number> | null {
  return useContext(ZoomStateContext);
}
