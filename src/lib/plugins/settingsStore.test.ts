import { getStore } from "@tauri-apps/plugin-store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginSettings, savePluginSettings } from "./settingsStore";

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

describe("savePluginSettings", () => {
  function memoryStore(initial: Record<string, unknown>) {
    let stored = initial;
    get.mockImplementation(async () => stored);
    set.mockImplementation(async (_key: string, value: Record<string, unknown>) => {
      stored = value;
    });
    return () => stored;
  }

  it("replaces only the plugin's own entry", async () => {
    get.mockResolvedValue({ other: { keep: true }, "a.b": { old: 1 } });
    await savePluginSettings("a.b", { size: 14 });
    expect(set).toHaveBeenCalledWith("settings", {
      other: { keep: true },
      "a.b": { size: 14 },
    });
  });

  it("keeps both plugins' changes when their saves overlap", async () => {
    const stored = memoryStore({ "a.b": { size: 12 }, "c.d": { on: false } });
    await Promise.all([
      savePluginSettings("a.b", { size: 14 }),
      savePluginSettings("c.d", { on: true }),
    ]);
    expect(stored()).toEqual({ "a.b": { size: 14 }, "c.d": { on: true } });
  });

  it("runs the next save after a failed write", async () => {
    const stored = memoryStore({});
    set.mockRejectedValueOnce(new Error("disk full"));
    const failed = savePluginSettings("a.b", { size: 14 });
    const next = savePluginSettings("c.d", { on: true });
    await expect(failed).rejects.toThrow("disk full");
    await next;
    expect(stored()).toEqual({ "c.d": { on: true } });
  });
});
