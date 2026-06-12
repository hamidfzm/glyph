// Module-level store of canvas viewports, keyed per tab + file. The viewer
// and editor are separate components that remount on every mode switch, so
// without shared state the board would snap back to the origin each time the
// user toggles view/edit. Keys live for the app session; a handful of small
// objects, so no eviction is needed.

import type { Viewport } from "./viewport";

const viewports = new Map<string, Viewport>();

export function loadViewport(key: string): Viewport | undefined {
  return viewports.get(key);
}

export function saveViewport(key: string, viewport: Viewport): void {
  viewports.set(key, viewport);
}
