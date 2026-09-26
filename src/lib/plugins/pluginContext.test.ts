import { describe, expect, it, vi } from "vitest";
import { installed } from "@/test/fixtures/pluginHost";
import { DisposerBag } from "./disposer";
import { buildPluginContext } from "./pluginContext";
import { createRegistry } from "./registry";

function context(bag: DisposerBag) {
  return buildPluginContext({
    registries: {
      commands: createRegistry(),
      statusBarItems: createRegistry(),
      remarkPlugins: createRegistry(),
      rehypePlugins: createRegistry(),
      fencedRenderers: createRegistry(),
      sidebarPanels: createRegistry(),
      settingsPanels: createRegistry(),
      styles: createRegistry(),
      exporters: createRegistry(),
      siteThemes: createRegistry(),
    },
    bag,
    plugin: installed(),
    settings: {},
    notify: vi.fn(),
    registerTranslations: vi.fn(),
    getWorkspaceRoot: () => null,
    settingsBackend: { load: async () => ({}), save: vi.fn() },
  });
}

describe("buildPluginContext i18n", () => {
  it("drops an early-disposed language listener from the plugin's bag", () => {
    // Renderers subscribe on every mount; a leftover entry per mount would pin
    // each detached render until the plugin unloads.
    const bag = new DisposerBag();
    const ctx = context(bag);
    for (let i = 0; i < 5; i++) ctx.i18n.onLanguageChange(() => {})();
    expect(bag.size).toBe(0);

    ctx.i18n.onLanguageChange(() => {});
    expect(bag.size).toBe(1);
  });
});
