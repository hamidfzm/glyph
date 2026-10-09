import { describe, expect, it, vi } from "vitest";
import { isLazyMarkdownPlugin } from "@/lib/markdown/lazyPlugins";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import plugins from "@/locales/en/plugins.json";
import { PLUGIN_API_VERSION, satisfiesApiVersion } from "./apiVersion";
import { CORE_PLUGINS, coreInstalledPlugin } from "./corePlugins";
import { createPluginHost } from "./host";

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

  it("leaves no KaTeX stylesheet behind when math is turned off while KaTeX loads", async () => {
    const host = createPluginHost(vi.fn());
    const math = CORE_PLUGINS.find((core) => core.id === "glyph.core.math");
    if (!math) throw new Error("math core plugin missing");
    await host.load(coreInstalledPlugin(math), math.load);
    const [katex] = host.rehypePlugins.list();
    if (!katex || !isLazyMarkdownPlugin(katex)) throw new Error("no lazy KaTeX entry");
    expect(host.styles.list()).toHaveLength(1);

    const loading = katex.load();
    host.unload(math.id);
    await loading;
    expect(host.styles.list()).toEqual([]);
  });

  it("hands a core plugin the permissions the list grants it, and no others", () => {
    const granted = (id: string) => {
      const core = CORE_PLUGINS.find((entry) => entry.id === id);
      if (!core) throw new Error(`${id} core plugin missing`);
      return coreInstalledPlugin(core).permissions;
    };
    expect(granted("glyph.core.tags")).toEqual(["workspace:read"]);
    expect(granted("glyph.core.backlinks")).toEqual(["workspace:read"]);
    expect(granted("glyph.core.d2")).toBeUndefined();
  });

  it("is on by default, with a Settings name and description for every plugin", () => {
    for (const core of CORE_PLUGINS) {
      expect(DEFAULT_SETTINGS.corePlugins[core.settingsKey], core.id).toBe(true);
      expect(Object.keys(plugins.core[core.settingsKey]).sort(), core.id).toEqual([
        "description",
        "name",
      ]);
    }
  });

  it("imports a module the host can activate", async () => {
    for (const core of CORE_PLUGINS) {
      const module = await core.load();
      expect(typeof module.default.activate).toBe("function");
    }
  });
});
