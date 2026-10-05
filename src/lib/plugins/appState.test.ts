import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_SNAPSHOT } from "@/lib/vault";
import {
  onPluginAppStateChange,
  type PluginAppState,
  pluginAppState,
  setPluginAppState,
} from "./appState";

const IDLE: PluginAppState = {
  workspaceRoot: null,
  activeDocument: null,
  snapshot: EMPTY_SNAPSHOT,
};

beforeEach(() => setPluginAppState(IDLE));

describe("plugin app state", () => {
  it("holds what was last mirrored", () => {
    const next = { ...IDLE, workspaceRoot: "/ws" };
    setPluginAppState(next);
    expect(pluginAppState()).toBe(next);
  });

  it("tells only the listeners of the part that changed", () => {
    const workspace = vi.fn();
    const activeDocument = vi.fn();
    const vault = vi.fn();
    const stop = [
      onPluginAppStateChange("workspace", workspace),
      onPluginAppStateChange("activeDocument", activeDocument),
      onPluginAppStateChange("vault", vault),
    ];

    setPluginAppState({ ...IDLE, workspaceRoot: "/ws" });
    expect(workspace).toHaveBeenCalledOnce();
    expect(activeDocument).not.toHaveBeenCalled();
    expect(vault).not.toHaveBeenCalled();

    setPluginAppState({ ...pluginAppState(), snapshot: { ...EMPTY_SNAPSHOT } });
    expect(vault).toHaveBeenCalledOnce();
    expect(workspace).toHaveBeenCalledOnce();
    for (const dispose of stop) dispose();
  });

  it("lets a listener read the new state", () => {
    let seen: string | null = null;
    const stop = onPluginAppStateChange("workspace", () => {
      seen = pluginAppState().workspaceRoot;
    });
    setPluginAppState({ ...IDLE, workspaceRoot: "/ws" });
    expect(seen).toBe("/ws");
    stop();
  });

  // Typing rewrites the text on every keystroke; plugins asked about documents.
  it("ignores a text change in the document that stays active", () => {
    const listener = vi.fn();
    const stop = onPluginAppStateChange("activeDocument", listener);
    setPluginAppState({ ...IDLE, activeDocument: { path: "/ws/a.md", text: "a" } });
    setPluginAppState({ ...IDLE, activeDocument: { path: "/ws/a.md", text: "ab" } });
    expect(listener).toHaveBeenCalledOnce();
    stop();
  });

  it("stops telling a listener once it is removed", () => {
    const listener = vi.fn();
    onPluginAppStateChange("workspace", listener)();
    setPluginAppState({ ...IDLE, workspaceRoot: "/ws" });
    expect(listener).not.toHaveBeenCalled();
  });

  it("keeps telling the other listeners when one throws", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const later = vi.fn();
    const stop = [
      onPluginAppStateChange("workspace", () => {
        throw new Error("plugin bug");
      }),
      onPluginAppStateChange("workspace", later),
    ];
    setPluginAppState({ ...IDLE, workspaceRoot: "/ws" });
    expect(later).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalled();
    for (const dispose of stop) dispose();
    errorSpy.mockRestore();
  });
});
