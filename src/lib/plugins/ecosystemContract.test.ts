import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { satisfiesApiVersion } from "@/lib/plugins/apiVersion";
import { createPluginHost } from "@/lib/plugins/host";
import { fetchRegistry, REGISTRY_CATEGORIES, type RegistryEntry } from "@/lib/plugins/marketplace";
import { installed } from "@/test/fixtures/pluginHost";

// Checks the host against real checkouts of glyph-md/plugin-template (built)
// and glyph-md/plugins. The Plugin contract CI job clones both into
// .ecosystem/; without that folder the suite is skipped.
const ECOSYSTEM = path.resolve(".ecosystem");

function readEcosystemFile(file: string): string {
  return readFileSync(path.join(ECOSYSTEM, file), "utf-8");
}

const REGISTRY_ENTRY_FIELDS = {
  id: true,
  name: true,
  description: true,
  version: true,
  apiVersion: true,
  permissions: true,
  packageUrl: true,
  sha256: true,
  sandbox: true,
  category: true,
  keywords: true,
  official: true,
} satisfies Record<keyof RegistryEntry, true>;

afterEach(() => vi.unstubAllGlobals());

describe.runIf(existsSync(ECOSYSTEM))("plugin ecosystem contract", () => {
  it("loads the built plugin template through the real loader", async () => {
    const manifest = JSON.parse(readEcosystemFile("plugin-template/manifest.json"));
    const host = createPluginHost(vi.fn());

    // happy-dom has no Worker, so this drives the main-thread module path;
    // the sandbox bootstrap has its own suite.
    await host.load(
      installed({
        id: manifest.id,
        apiVersion: manifest.apiVersion,
        sandbox: false,
        mainSource: readEcosystemFile("plugin-template/main.js"),
      }),
    );

    expect(host.listLoaded().map((p) => p.id)).toEqual([manifest.id]);
    expect(host.commands.list()).not.toHaveLength(0);
  });

  it("reads exactly the entry fields and categories the marketplace schema defines", () => {
    const entry = JSON.parse(readEcosystemFile("plugins/index.schema.json")).definitions.entry;

    expect(Object.keys(entry.properties).sort()).toEqual(Object.keys(REGISTRY_ENTRY_FIELDS).sort());
    expect(entry.properties.category.enum).toEqual([...REGISTRY_CATEGORIES]);
  });

  it("accepts every published marketplace entry", async () => {
    const index = JSON.parse(readEcosystemFile("plugins/index.json"));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(index) }),
    );

    const entries = await fetchRegistry();

    expect(entries.map((e) => e.id)).toEqual(index.plugins.map((p: RegistryEntry) => p.id));
    for (const entry of entries) {
      expect(satisfiesApiVersion(entry.apiVersion), entry.id).toBe(true);
    }
  });
});
