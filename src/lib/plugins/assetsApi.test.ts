import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAssetsApi } from "./assetsApi";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe("createAssetsApi", () => {
  it("readBinary returns the plugin file's bytes from Rust", async () => {
    vi.mocked(invoke).mockResolvedValue([1, 2, 255]);
    const assets = createAssetsApi("com.x.pkg");

    await expect(assets.readBinary("assets/data.bin")).resolves.toEqual(
      new Uint8Array([1, 2, 255]),
    );
    expect(invoke).toHaveBeenCalledWith("read_plugin_asset", {
      id: "com.x.pkg",
      path: "assets/data.bin",
    });
  });

  it("readText decodes the bytes as UTF-8", async () => {
    vi.mocked(invoke).mockResolvedValue(Array.from(new TextEncoder().encode("سلام")));
    const assets = createAssetsApi("com.x.pkg");

    await expect(assets.readText("assets/fa.txt")).resolves.toBe("سلام");
  });

  it("propagates Rust rejections (undeclared or missing files)", async () => {
    vi.mocked(invoke).mockRejectedValue('"nope" is not a declared file of plugin "com.x.pkg"');
    const assets = createAssetsApi("com.x.pkg");

    await expect(assets.readText("nope")).rejects.toBeTruthy();
  });
});
