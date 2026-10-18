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

  // The map is keyed by plugin id; an id the prototype answers for must not
  // read as a stored map (`__proto__` would hand the plugin Object.prototype).
  it("returns {} for an id that is only a prototype property", async () => {
    get.mockResolvedValue({ "com.x.a": { k: 1 } });
    await expect(loadPluginSettings("__proto__")).resolves.toEqual({});
    await expect(loadPluginSettings("constructor")).resolves.toEqual({});
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
  it("replaces only the plugin's own entry", async () => {
    get.mockResolvedValue({ other: { keep: true }, "a.b": { old: 1 } });
    await savePluginSettings("a.b", { size: 14 });
    expect(set).toHaveBeenCalledWith("settings", {
      other: { keep: true },
      "a.b": { size: 14 },
    });
  });
});
