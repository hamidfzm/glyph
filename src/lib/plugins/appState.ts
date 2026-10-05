import { EMPTY_SNAPSHOT, type VaultSnapshot } from "@/lib/vault";
import type { Disposer } from "./disposer";

// What plugins may know about the app right now, mirrored from the tabs
// context by usePluginAppBridge. Module-level like the file type registry: the
// plugin context is built in plain modules with no route to a React context.

export interface PluginAppState {
  workspaceRoot: string | null;
  /** `text` is null while the document loads, or when it has none (an image). */
  activeDocument: { path: string; text: string | null } | null;
  snapshot: VaultSnapshot;
}

type AppStateTopic = "workspace" | "activeDocument" | "vault";

let state: PluginAppState = {
  workspaceRoot: null,
  activeDocument: null,
  snapshot: EMPTY_SNAPSHOT,
};

const listeners: Record<AppStateTopic, Set<() => void>> = {
  workspace: new Set(),
  activeDocument: new Set(),
  vault: new Set(),
};

function emit(topic: AppStateTopic): void {
  for (const listener of [...listeners[topic]]) {
    try {
      listener();
    } catch (err) {
      console.error(`Plugin ${topic} listener threw:`, err);
    }
  }
}

export function pluginAppState(): PluginAppState {
  return state;
}

/** Replace the mirrored state and tell the listeners of each part that changed. */
export function setPluginAppState(next: PluginAppState): void {
  const previous = state;
  state = next;
  if (previous.workspaceRoot !== next.workspaceRoot) emit("workspace");
  // Typing changes the text on every keystroke; only another document counts.
  if (previous.activeDocument?.path !== next.activeDocument?.path) emit("activeDocument");
  if (previous.snapshot !== next.snapshot) emit("vault");
}

export function onPluginAppStateChange(topic: AppStateTopic, listener: () => void): Disposer {
  listeners[topic].add(listener);
  return () => {
    listeners[topic].delete(listener);
  };
}
