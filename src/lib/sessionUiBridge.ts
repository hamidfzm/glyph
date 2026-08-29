import type { SidebarVisibility } from "@/lib/workspaceSession";

// Window-level UI state the workspace session snapshot needs but that lives in
// providers mounted below TabsProvider (zoom, sidebar layout). Those providers
// register accessors here; the session capture/restore hook reads them without
// reshuffling the provider stack. Module singletons, one window each.

export interface SessionZoomBridge {
  /** Live per-note-tab zoom multipliers, keyed by tab id. */
  zoomByTabId: () => Record<string, number>;
  /** Merge restored multipliers (keyed by tab id) into the live map. */
  seedZoom: (byTabId: Record<string, number>) => void;
}

export interface SessionSidebarBridge {
  visibility: () => SidebarVisibility;
  /** Apply restored visibility to the local mirror, never the global setting.
   *  `null` resyncs the mirror to the setting (a workspace whose snapshot
   *  carries no sidebar state must not inherit the previous workspace's). */
  applyVisibility: (visibility: SidebarVisibility | null) => void;
}

let zoomBridge: SessionZoomBridge | null = null;
let sidebarBridge: SessionSidebarBridge | null = null;

export function registerSessionZoomBridge(bridge: SessionZoomBridge | null): void {
  zoomBridge = bridge;
}

export function registerSessionSidebarBridge(bridge: SessionSidebarBridge | null): void {
  sidebarBridge = bridge;
}

export function sessionZoomBridge(): SessionZoomBridge | null {
  return zoomBridge;
}

export function sessionSidebarBridge(): SessionSidebarBridge | null {
  return sidebarBridge;
}
