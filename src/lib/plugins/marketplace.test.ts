import { invoke } from "@tauri-apps/api/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRegistry, findUpdates, installFromRegistry, type RegistryEntry } from "./marketplace";

function entry(over: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    id: "com.x.demo",
    name: "Demo",
    version: "1.0.0",
    apiVersion: "^1.0.0",
    mainUrl: "https://example.test/main.js",
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
  it("downloads the entry and installs a synthesized manifest", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve("export default {};") }),
    );
    vi.mocked(invoke).mockResolvedValue(undefined);

    await installFromRegistry(
      entry({ version: "2.0.0", description: "d", permissions: ["workspace:read"], sandbox: true }),
    );

    const [cmd, args] = vi.mocked(invoke).mock.calls.at(-1) ?? [];
    expect(cmd).toBe("install_plugin_files");
    expect(args).toMatchObject({ main: "export default {};" });
    const manifest = JSON.parse((args as { manifest: string }).manifest);
    expect(manifest).toMatchObject({
      id: "com.x.demo",
      version: "2.0.0",
      apiVersion: "^1.0.0",
      description: "d",
      permissions: ["workspace:read"],
      sandbox: true,
    });
  });

  it("throws when the download fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(installFromRegistry(entry())).rejects.toThrow(/download failed/);
  });

  // SHA-256 of "export default {};", uppercase to prove comparison is case-insensitive.
  const GOOD_SHA = "9f085b1079ab38f776bbb3930dfd067a838ca3e0483aff8625f88837e8ed964c";

  it("installs when the download matches the declared sha256", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve("export default {};") }),
    );
    vi.mocked(invoke).mockResolvedValue(undefined);

    await installFromRegistry(entry({ sha256: GOOD_SHA.toUpperCase() }));

    expect(vi.mocked(invoke)).toHaveBeenCalledWith("install_plugin_files", expect.anything());
  });

  it("refuses to install when the download does not match the declared sha256", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve("export default { tampered: true };"),
      }),
    );
    vi.mocked(invoke).mockReset();

    await expect(installFromRegistry(entry({ sha256: GOOD_SHA }))).rejects.toThrow(
      /checksum mismatch/,
    );
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
  });
});
