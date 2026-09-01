import { getStore } from "@tauri-apps/plugin-store";
import { describe, expect, it, vi } from "vitest";
import { openStore } from "@/lib/store";

describe("openStore", () => {
  it("returns the store the backend opened", async () => {
    const store = { get: vi.fn() };
    vi.mocked(getStore).mockResolvedValueOnce(store as never);

    await expect(openStore("settings.json")).resolves.toBe(store);
  });

  it("rejects, naming the file, when the backend did not open it", async () => {
    vi.mocked(getStore).mockResolvedValueOnce(null);

    await expect(openStore("plugins.json")).rejects.toThrow("plugins.json");
  });
});
