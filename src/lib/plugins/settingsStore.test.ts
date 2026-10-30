import { getStore } from "@tauri-apps/plugin-store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginSettings, savePluginSetting } from "./settingsStore";

const get = vi.fn();
const set = vi.fn();

beforeEach(() => {
  get.mockReset();
  set.mockReset();
  vi.mocked(getStore).mockReset();
  vi.mocked(getStore).mockResolvedValue({ get, set } as never);
});

describe("loadPluginSettings", () => {
  it("returns the plugin's stored map", async () => {
    get.mockResolvedValue({ "a.b": { size: 12 } });
    expect(await loadPluginSettings("a.b")).toEqual({ size: 12 });
  });

  it("returns {} for an unknown plugin or empty store", async () => {
    get.mockResolvedValue(null);
    expect(await loadPluginSettings("a.b")).toEqual({});
    get.mockResolvedValue({ other: { x: 1 } });
    expect(await loadPluginSettings("a.b")).toEqual({});
  });

  it("returns {} when the store throws", async () => {
    vi.mocked(getStore).mockRejectedValue(new Error("no store"));
    expect(await loadPluginSettings("a.b")).toEqual({});
  });
});

describe("savePluginSetting", () => {
  function memoryStore(initial: Record<string, unknown>) {
    let stored = initial;
    get.mockImplementation(async () => stored);
    set.mockImplementation(async (_key: string, value: Record<string, unknown>) => {
      stored = value;
    });
    return () => stored;
  }

  it("changes one key of the plugin's entry and nothing else", async () => {
    const stored = memoryStore({ other: { keep: true }, "a.b": { old: 1, size: 12 } });
    await savePluginSetting("a.b", "size", 14);
    expect(stored()).toEqual({ other: { keep: true }, "a.b": { old: 1, size: 14 } });
  });

  it("keeps a key a settings sync wrote after the plugin read its settings", async () => {
    // The plugin hydrated { size: 12 }; a sync has since added theme.
    const stored = memoryStore({ "a.b": { size: 12, theme: "nord" } });
    await savePluginSetting("a.b", "size", 14);
    expect(stored()).toEqual({ "a.b": { size: 14, theme: "nord" } });
  });

  it("starts an entry for a plugin with none", async () => {
    const stored = memoryStore({ "a.b": "not a map" });
    await savePluginSetting("a.b", "size", 14);
    expect(stored()).toEqual({ "a.b": { size: 14 } });
  });

  it("keeps both plugins' changes when their saves overlap", async () => {
    const stored = memoryStore({ "a.b": { size: 12 }, "c.d": { on: false } });
    await Promise.all([savePluginSetting("a.b", "size", 14), savePluginSetting("c.d", "on", true)]);
    expect(stored()).toEqual({ "a.b": { size: 14 }, "c.d": { on: true } });
  });

  it("runs the next save after a failed write", async () => {
    const stored = memoryStore({});
    set.mockRejectedValueOnce(new Error("disk full"));
    const failed = savePluginSetting("a.b", "size", 14);
    const next = savePluginSetting("c.d", "on", true);
    await expect(failed).rejects.toThrow("disk full");
    await next;
    expect(stored()).toEqual({ "c.d": { on: true } });
  });
});
