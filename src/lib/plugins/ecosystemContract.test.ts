import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { satisfiesApiVersion } from "@/lib/plugins/apiVersion";
import { createPluginHost } from "@/lib/plugins/host";
import { fetchRegistry, REGISTRY_CATEGORIES, type RegistryEntry } from "@/lib/plugins/marketplace";
import { installed } from "@/test/fixtures/pluginHost";

// Checks the host against real checkouts of glyph-md/plugin-template (built)
// and glyph-md/plugins in .ecosystem/. Only the Plugin contract CI job (or a
// local run that sets GLYPH_PLUGIN_CONTRACT) runs it, so stale local clones
// never gate commits.
const ECOSYSTEM = path.resolve(__dirname, "../../../.ecosystem");

function readEcosystemFile(file: string): string {
  return readFileSync(path.join(ECOSYSTEM, file), "utf-8");
}

type FieldPresence<T> = { [K in keyof T]-?: object extends Pick<T, K> ? "optional" : "required" };

const REGISTRY_ENTRY_FIELDS: FieldPresence<RegistryEntry> = {
  id: "required",
  name: "required",
  description: "optional",
  version: "required",
  apiVersion: "required",
  permissions: "optional",
  packageUrl: "required",
  sha256: "required",
  sandbox: "optional",
  category: "optional",
  keywords: "optional",
  official: "optional",
};

afterEach(() => vi.unstubAllGlobals());

describe.runIf(process.env.GLYPH_PLUGIN_CONTRACT)("plugin ecosystem contract", () => {
  it("loads the built plugin template through the real loader", async () => {
    const manifest = JSON.parse(readEcosystemFile("plugin-template/manifest.json"));
    // The template contributes UI, which only full-trust plugins can; happy-dom
    // has no Worker to run the sandboxed path anyway.
    expect(manifest.sandbox).toBe(false);
    const host = createPluginHost(vi.fn());

    await host.load(
      installed({
        id: manifest.id,
        apiVersion: manifest.apiVersion,
        sandbox: false,
        mainSource: readEcosystemFile(`plugin-template/${manifest.main ?? "main.js"}`),
      }),
    );

    expect(host.listLoaded().map((p) => p.id)).toEqual([manifest.id]);
    expect(host.commands.list()).not.toHaveLength(0);
  });

  it("reads exactly the entry fields and categories the marketplace schema defines", () => {
    const entry = JSON.parse(readEcosystemFile("plugins/index.schema.json")).definitions.entry;
    const hostRequired = Object.entries(REGISTRY_ENTRY_FIELDS)
      .filter(([, presence]) => presence === "required")
      .map(([field]) => field);

    expect(Object.keys(entry.properties).sort()).toEqual(Object.keys(REGISTRY_ENTRY_FIELDS).sort());
    // The host may tolerate more missing fields than the schema allows, never fewer.
    expect(entry.required).toEqual(expect.arrayContaining(hostRequired));
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
