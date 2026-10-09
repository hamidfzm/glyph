import { beforeAll } from "vitest";
import { CORE_PLUGINS } from "@/lib/plugins/corePlugins";
import type { CorePluginSettings } from "@/lib/settings";
import { CHUNK_LOAD_TIMEOUT_MS } from "@/test/chunkLoadTimeout";

/**
 * Imports the named core plugins once, before the file's tests run. A plugin's
 * first import can be slow when the full suite runs under machine load, slower
 * than the second waitFor allows, so a suite that switches real plugins on
 * pays for it here and its own waits cover only the host's work.
 */
export function preloadCorePlugins(...keys: (keyof CorePluginSettings)[]): void {
  beforeAll(async () => {
    const named = CORE_PLUGINS.filter((core) => keys.includes(core.settingsKey));
    await Promise.all(named.map((core) => core.load()));
  }, CHUNK_LOAD_TIMEOUT_MS);
}
