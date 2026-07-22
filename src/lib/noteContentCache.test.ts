import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readNoteCached } from "./noteContentCache";

describe("readNoteCached", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockClear();
  });

  it("reads a note once and serves later peeks from the cache", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("body");

    await expect(readNoteCached("/w/A.md")).resolves.toBe("body");
    await expect(readNoteCached("/w/A.md")).resolves.toBe("body");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("read_file", { path: "/w/A.md" });
  });

  it("evicts a failed read so the next peek retries", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("denied"));
    await expect(readNoteCached("/w/B.md")).rejects.toThrow("denied");

    vi.mocked(invoke).mockResolvedValueOnce("recovered");
    await expect(readNoteCached("/w/B.md")).resolves.toBe("recovered");
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
