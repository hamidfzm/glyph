import { invoke } from "@tauri-apps/api/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PLUGIN_API_VERSION } from "./apiVersion";
import { fetchRegistry, findUpdates, installFromRegistry, type RegistryEntry } from "./marketplace";

// Fixed package bytes for install tests, with their real SHA-256 (hex of
// the four bytes 1,2,3,4). Zip parsing happens in Rust, so the frontend
// treats the payload as opaque bytes.
const PACKAGE_BYTES = new Uint8Array([1, 2, 3, 4]);
const PACKAGE_SHA = "9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a";

function entry(over: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    id: "com.x.demo",
    name: "Demo",
    version: "1.0.0",
    apiVersion: `^${PLUGIN_API_VERSION}`,
    packageUrl: "https://example.test/plugin.zip",
    sha256: PACKAGE_SHA,
    ...over,
  };
}

/** fetch stub resolving to the given package bytes. */
function fetchPackage(bytes: Uint8Array = PACKAGE_BYTES) {
  return vi.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: () => Promise.resolve(bytes.buffer.slice(0)),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchRegistry", () => {
  it("returns the plugins array from the index", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ plugins: [entry()] }) }),
    );
    expect(await fetchRegistry()).toEqual([entry()]);
  });

  it("returns [] when the payload has no plugins array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }),
    );
    expect(await fetchRegistry()).toEqual([]);
  });

  it("throws on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(fetchRegistry()).rejects.toThrow(/404/);
  });
});

describe("findUpdates", () => {
  it("flags installed plugins whose registry version differs", () => {
    const updates = findUpdates(
      [{ id: "com.x.demo", version: "1.0.0" }],
      [entry({ version: "1.1.0" })],
    );
    expect(updates).toEqual([{ entry: entry({ version: "1.1.0" }), installedVersion: "1.0.0" }]);
  });

  it("ignores matching versions and plugins that aren't installed", () => {
    expect(
      findUpdates([{ id: "com.x.demo", version: "1.0.0" }], [entry({ version: "1.0.0" })]),
    ).toEqual([]);
    expect(findUpdates([], [entry()])).toEqual([]);
  });
});

describe("installFromRegistry", () => {
  it("downloads the package, verifies it, and hands the bytes to Rust", async () => {
    vi.stubGlobal("fetch", fetchPackage());
    vi.mocked(invoke).mockResolvedValue(undefined);

    // Uppercase digest proves the comparison is case-insensitive.
    await installFromRegistry(entry({ sha256: PACKAGE_SHA.toUpperCase() }));

    expect(vi.mocked(invoke)).toHaveBeenCalledWith("install_plugin_package", {
      bytes: [1, 2, 3, 4],
    });
  });

  it("throws when the download fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(installFromRegistry(entry())).rejects.toThrow(/download failed/);
  });

  it("refuses to install when the package does not match the declared sha256", async () => {
    vi.stubGlobal("fetch", fetchPackage(new Uint8Array([9, 9, 9])));
    vi.mocked(invoke).mockReset();

    await expect(installFromRegistry(entry())).rejects.toThrow(/checksum mismatch/);
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
  });
});
