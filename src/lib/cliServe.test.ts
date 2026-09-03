import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type CliServeRequest, getCliServeRequest, resetCliServeRequestCache } from "./cliServe";

const REQUEST: CliServeRequest = { root: "/ws", outDir: "/tmp/glyph-serve-1" };

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  resetCliServeRequestCache();
});

describe("getCliServeRequest", () => {
  it("asks the backend once and reuses the answer", async () => {
    vi.mocked(invoke).mockResolvedValue(REQUEST);
    await expect(getCliServeRequest()).resolves.toEqual(REQUEST);
    await expect(getCliServeRequest()).resolves.toEqual(REQUEST);
    // The reveal gate and the serve runner both ask; they must agree, or a
    // serve process could reveal its window while the other renders.
    expect(vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "get_cli_serve")).toHaveLength(1);
  });

  it("resolves null outside Tauri instead of rejecting", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("no tauri"));
    await expect(getCliServeRequest()).resolves.toBeNull();
  });

  it("resolves null on a launch that is not a serve", async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    await expect(getCliServeRequest()).resolves.toBeNull();
  });
});
