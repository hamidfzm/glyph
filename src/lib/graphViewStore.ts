// Module-level store of graph view state, keyed by workspace root. `TabContent`
// renders the graph only while its tab is active, so switching to a document tab
// unmounts the whole subtree; without shared state the camera, the auto-fit flag
// and the settled layout would all be rebuilt from scratch on every return.
// One entry per workspace, cleared when the graph tab closes or the workspace
// changes, so no eviction is needed. Session-only: nothing reaches disk.

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

export function clearGraphView(key: string): void {
  states.delete(key);
}
