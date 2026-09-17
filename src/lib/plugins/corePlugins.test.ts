import { describe, expect, it } from "vitest";
import { PLUGIN_API_VERSION, satisfiesApiVersion } from "./apiVersion";
import { CORE_PLUGINS, coreInstalledPlugin } from "./corePlugins";

describe("CORE_PLUGINS", () => {
  it("uses the id prefix the backend reserves, one entry per setting", () => {
    for (const core of CORE_PLUGINS) expect(core.id).toMatch(/^glyph\.core\./);
    const keys = CORE_PLUGINS.map((core) => core.settingsKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("describes a bundled, full-trust host entry the version gate accepts", () => {
    const [core] = CORE_PLUGINS;
    const entry = coreInstalledPlugin(core);
    expect(entry).toMatchObject({ id: core.id, sandbox: false, apiVersion: PLUGIN_API_VERSION });
    expect(satisfiesApiVersion(entry.apiVersion)).toBe(true);
  });

  it("imports a module the host can activate", async () => {
    for (const core of CORE_PLUGINS) {
      const module = await core.load();
      expect(typeof module.default.activate).toBe("function");
    }
  });
});
