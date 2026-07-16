import { invoke } from "@tauri-apps/api/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setDefaultMarkdownApp } from "./defaultApp";

describe("setDefaultMarkdownApp", () => {
  afterEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("returns the backend outcome tag", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("openedSettings");
    expect(await setDefaultMarkdownApp()).toBe("openedSettings");
    expect(invoke).toHaveBeenCalledWith("set_default_markdown_app");
  });

  it("resolves to 'error' and never throws when the command fails", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke).mockRejectedValueOnce(new Error("boom"));
    expect(await setDefaultMarkdownApp()).toBe("error");
    errSpy.mockRestore();
  });
});
