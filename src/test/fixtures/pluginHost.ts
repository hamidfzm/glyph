import { vi } from "vitest";
import { PLUGIN_API_VERSION } from "@/lib/plugins/apiVersion";
import type { ModuleImporter } from "@/lib/plugins/loader";
import type { InstalledPlugin, PluginModule } from "@/lib/plugins/types";

// Plugin fixtures and module importers shared by the host suites.

export function installed(overrides: Partial<InstalledPlugin> = {}): InstalledPlugin {
  return {
    id: "com.x.demo",
    name: "Demo",
    version: "1.0.0",
    apiVersion: `^${PLUGIN_API_VERSION}`,
    // Host tests drive the full-trust module path unless a case opts into
    // the sandbox; the consent gating above the host is the provider's job.
    sandbox: false,
    dir: "/plugins/com.x.demo",
    mainSource: "export default …",
    ...overrides,
  };
}

/** An importer that yields the given module object, bypassing the data: import. */
export function importerFor(module: PluginModule): ModuleImporter {
  return vi.fn().mockResolvedValue({ default: module });
}

/** An importer whose resolution the test controls, for overlap/race cases. */
export function deferredImporterFor(module: PluginModule): {
  importer: ModuleImporter;
  resolve: () => void;
} {
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  return {
    importer: () => gate.then(() => ({ default: module })),
    resolve: release,
  };
}
