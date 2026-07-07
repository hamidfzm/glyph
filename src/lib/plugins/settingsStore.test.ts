import { load } from "@tauri-apps/plugin-store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginSettings, savePluginSettings } from "./settingsStore";

const get = vi.fn();
const set = vi.fn();

beforeEach(() => {
  get.mockReset();
  set.mockReset();
  vi.mocked(load).mockReset();
  vi.mocked(load).mockResolvedValue({ get, set } as never);
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
    vi.mocked(load).mockRejectedValue(new Error("no store"));
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
