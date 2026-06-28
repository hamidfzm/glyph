import { load } from "@tauri-apps/plugin-store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadDisabled, saveDisabled } from "./disabledStore";

const get = vi.fn();
const set = vi.fn();

beforeEach(() => {
  get.mockReset();
  set.mockReset();
  vi.mocked(load).mockReset();
  vi.mocked(load).mockResolvedValue({ get, set } as never);
});

describe("loadDisabled", () => {
  it("returns the stored array", async () => {
    get.mockResolvedValue(["a", "b"]);
    expect(await loadDisabled()).toEqual(["a", "b"]);
  });

  it("returns [] when nothing is stored", async () => {
    get.mockResolvedValue(null);
    expect(await loadDisabled()).toEqual([]);
  });

  it("returns [] when the store throws", async () => {
    vi.mocked(load).mockRejectedValue(new Error("no store"));
    expect(await loadDisabled()).toEqual([]);
  });
});

describe("saveDisabled", () => {
  it("writes the list to the store", async () => {
    await saveDisabled(["x"]);
    expect(set).toHaveBeenCalledWith("disabled", ["x"]);
  });
});
