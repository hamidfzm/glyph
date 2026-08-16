import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectConsole } from "@/test/consoleGuard";
import { PLUGIN_API_VERSION } from "./apiVersion";
import {
  fetchRegistry,
  filterRegistry,
  findUpdates,
  installFromRegistry,
  type RegistryEntry,
  registryReadmeUrl,
} from "./marketplace";

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

/** Package download stub resolving to the given bytes. Packages come down
 *  through the Rust-side fetch (GitHub release assets send no CORS headers),
 *  so this stubs that module rather than the global. */
function fetchPackage(bytes: Uint8Array = PACKAGE_BYTES) {
  const stub = vi.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: () => Promise.resolve(bytes.buffer.slice(0)),
  });
  vi.mocked(tauriFetch).mockImplementation(stub);
  return stub;
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

  it("drops entries whose sha256 is missing or malformed", async () => {
    expectConsole(/Dropping registry entry with missing or malformed sha256/);
    const plugins = [
      entry(),
      null as never,
      "junk" as never,
      entry({ id: "b.nohash", sha256: undefined as never }),
      entry({ id: "c.short", sha256: "abc123" }),
      entry({ id: "d.nonhex", sha256: "z".repeat(64) }),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ plugins }) }),
    );
    expect((await fetchRegistry()).map((e) => e.id)).toEqual(["com.x.demo"]);
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
    fetchPackage();
    vi.mocked(invoke).mockResolvedValue({ id: "com.x.demo" });

    // Uppercase digest proves the comparison is case-insensitive.
    await installFromRegistry(entry({ sha256: PACKAGE_SHA.toUpperCase() }));

    expect(vi.mocked(invoke)).toHaveBeenCalledWith("install_plugin_package", {
      bytes: [1, 2, 3, 4],
    });
  });

  it("uninstalls and rejects a package whose manifest id differs from the entry", async () => {
    fetchPackage();
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockImplementation((cmd) =>
      Promise.resolve(cmd === "install_plugin_package" ? { id: "com.x.other" } : undefined),
    );

    await expect(installFromRegistry(entry())).rejects.toThrow(/declares manifest id/);
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("uninstall_plugin", { id: "com.x.other" });
  });

  it("refuses to download at all without a valid sha256", async () => {
    const fetchSpy = fetchPackage();
    vi.mocked(invoke).mockReset();

    await expect(installFromRegistry(entry({ sha256: "" }))).rejects.toThrow(/no valid sha256/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
  });

  // The regression: GitHub serves release assets without CORS headers, so the
  // webview's own fetch rejects with "Failed to fetch" and every marketplace
  // install died before the bytes were seen. The download has to go through
  // Rust, and this fails if it ever moves back to the global fetch.
  it("downloads the package through Rust, not the webview fetch", async () => {
    const webviewFetch = vi.fn();
    vi.stubGlobal("fetch", webviewFetch);
    const rustFetch = fetchPackage();
    vi.mocked(invoke).mockResolvedValue({ id: "com.x.demo" } as never);

    await installFromRegistry(entry());

    expect(rustFetch).toHaveBeenCalledWith("https://example.test/plugin.zip");
    expect(webviewFetch).not.toHaveBeenCalled();
  });

  it("throws when the download fails", async () => {
    vi.mocked(tauriFetch).mockResolvedValue({ ok: false, status: 500 } as Response);
    await expect(installFromRegistry(entry())).rejects.toThrow(/download failed/);
  });

  it("refuses to install when the package does not match the declared sha256", async () => {
    fetchPackage(new Uint8Array([9, 9, 9]));
    vi.mocked(invoke).mockReset();

    await expect(installFromRegistry(entry())).rejects.toThrow(/checksum mismatch/);
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
  });
});

describe("filterRegistry", () => {
  const entries = [
    entry({ id: "a.theme", name: "Nord Theme", category: "themes" }),
    entry({
      id: "b.dict",
      name: "Dictionary",
      category: "language",
      keywords: ["farsi", "spellcheck"],
    }),
  ];

  it("returns everything for an empty query and no category", () => {
    expect(filterRegistry(entries, "", "")).toHaveLength(2);
  });

  it("matches name, id, and keywords case-insensitively", () => {
    expect(filterRegistry(entries, "NORD", "").map((e) => e.id)).toEqual(["a.theme"]);
    expect(filterRegistry(entries, "b.dict", "").map((e) => e.id)).toEqual(["b.dict"]);
    expect(filterRegistry(entries, "FARSI", "").map((e) => e.id)).toEqual(["b.dict"]);
  });

  it("restricts to a category, combined with the query", () => {
    expect(filterRegistry(entries, "", "language").map((e) => e.id)).toEqual(["b.dict"]);
    expect(filterRegistry(entries, "nord", "language")).toHaveLength(0);
  });
});

describe("registryReadmeUrl", () => {
  it("points at the plugin's registry folder README", () => {
    expect(registryReadmeUrl("com.x.demo")).toBe(
      "https://raw.githubusercontent.com/glyph-md/plugins/main/plugins/com.x.demo/README.md",
    );
  });
});
