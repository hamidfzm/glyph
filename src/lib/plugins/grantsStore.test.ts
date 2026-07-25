import { load } from "@tauri-apps/plugin-store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadGrants, saveGrants } from "./grantsStore";

const get = vi.fn();
const set = vi.fn();

beforeEach(() => {
  get.mockReset();
  set.mockReset();
  vi.mocked(load).mockReset();
  vi.mocked(load).mockResolvedValue({ get, set } as never);
});

describe("loadGrants", () => {
  it("returns the stored grants", async () => {
    const grants = { "com.x.demo": { permissions: ["workspace:read"], fullTrust: false } };
    get.mockResolvedValue(grants);
    expect(await loadGrants()).toEqual(grants);
  });

  it("returns {} when nothing is stored", async () => {
    get.mockResolvedValue(null);
    expect(await loadGrants()).toEqual({});
  });

  it("returns {} when the store throws", async () => {
    vi.mocked(load).mockRejectedValue(new Error("no store"));
    expect(await loadGrants()).toEqual({});
  });
});

describe("saveGrants", () => {
  it("writes the grants to the store", async () => {
    const grants = { "com.x.demo": { permissions: [], fullTrust: true } };
    await saveGrants(grants);
    expect(set).toHaveBeenCalledWith("grants", grants);
  });
});
