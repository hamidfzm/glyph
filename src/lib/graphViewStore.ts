// Module-level store of graph view state, keyed by workspace root. `TabContent`
// renders the graph only while its tab is active, so switching to a document tab
// unmounts the whole subtree; without shared state the camera, the auto-fit flag
// and the settled layout would all be rebuilt from scratch on every return.
// One entry per open graph tab, so no eviction is needed. Session-only: nothing
// reaches disk.

import type { Camera } from "./graphCanvas";
import type { NodePosition } from "./graphSimulation";

export interface GraphViewState {
  camera: Camera;
  /** False once the user has taken the camera by hand. */
  autoFit: boolean;
  positions: ReadonlyMap<string, NodePosition>;
}

const states = new Map<string, Partial<GraphViewState>>();

export function loadGraphView(key: string): Partial<GraphViewState> | undefined {
  return states.get(key);
}

/** Merge a slice in, so the simulation and the view can write independently. */
export function saveGraphView(key: string, patch: Partial<GraphViewState>): void {
  states.set(key, { ...states.get(key), ...patch });
}

/**
 * Drop every entry whose graph tab is gone. Reconciling against the live tabs
 * beats clearing at the close call site: a close runs while the view is still
 * mounted and its animation loop is still writing positions, so a clear issued
 * there is undone by the next frame.
 */
export function pruneGraphViews(keep: ReadonlySet<string>): void {
  for (const key of states.keys()) {
    if (!keep.has(key)) states.delete(key);
  }
}

/** Test seam: drop a single entry without reconciling the whole store. */
export function clearGraphView(key: string): void {
  states.delete(key);
}
