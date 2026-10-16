import { invoke } from "@tauri-apps/api/core";
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

// A well-formed SHA-256 (of the four bytes 1,2,3,4). The renderer only checks
// the shape; the download and the hash are verified in Rust.
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
  // The registry fetch, the download, the hash, and the manifest id are all
  // checked in Rust against the index it fetches itself: the renderer names
  // the plugin and nothing else, so a compromised renderer cannot hand over
  // a URL, a hash, or bytes of its own.
  it("hands Rust the entry id and nothing else", async () => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue({ id: "com.x.demo" });

    const plugin = await installFromRegistry(entry({ packageUrl: "https://example.test/x.zip" }));

    expect(plugin.id).toBe("com.x.demo");
    expect(vi.mocked(invoke)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("install_plugin_from_registry", {
      id: "com.x.demo",
    });
  });

  it("never fetches the package from the renderer", async () => {
    const webviewFetch = vi.fn();
    vi.stubGlobal("fetch", webviewFetch);
    vi.mocked(invoke).mockResolvedValue({ id: "com.x.demo" } as never);

    await installFromRegistry(entry());

    expect(webviewFetch).not.toHaveBeenCalled();
  });

  it("refuses to install without a valid sha256", async () => {
    vi.mocked(invoke).mockReset();

    await expect(installFromRegistry(entry({ sha256: "" }))).rejects.toThrow(/no valid sha256/);
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
  });

  it("surfaces a refusal from Rust", async () => {
    vi.mocked(invoke).mockRejectedValue("checksum mismatch for com.x.demo");

    await expect(installFromRegistry(entry())).rejects.toBe("checksum mismatch for com.x.demo");
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
