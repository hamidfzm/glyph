import { afterEach, describe, expect, it, vi } from "vitest";
import { installed } from "@/test/fixtures/pluginHost";
import { mountDocumentBody } from "@/test/mountDocumentBody";
import { DisposerBag } from "./disposer";
import { overlays } from "./overlays";
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

describe("buildPluginContext overlays", () => {
  const overlay = { id: "show", label: "Slide show", mount: () => {} };

  afterEach(() => {
    for (const open of overlays.list()) open.close();
  });

  it("opens one overlay at a time and leaves the bag once closed", () => {
    const bag = new DisposerBag();
    const ctx = context(bag);

    ctx.ui.openOverlay(overlay);
    const close = ctx.ui.openOverlay({ ...overlay, id: "second" });
    expect(overlays.list().map((open) => open.id)).toEqual(["second"]);
    expect(bag.size).toBe(1);

    close();
    expect(overlays.list()).toEqual([]);
    expect(bag.size).toBe(0);
  });

  it("closes from the host's handle the same way", () => {
    const bag = new DisposerBag();
    context(bag).ui.openOverlay(overlay);

    overlays.list()[0].close();
    expect(overlays.list()).toEqual([]);
    expect(bag.size).toBe(0);
  });

  it("closes an open overlay when the plugin unloads", () => {
    const bag = new DisposerBag();
    context(bag).ui.openOverlay(overlay);

    bag.dispose();
    expect(overlays.list()).toEqual([]);
  });
});

describe("buildPluginContext documents", () => {
  it("serves the viewer's rendered document", async () => {
    mountDocumentBody("<p>Hi</p>");
    const html = await context(new DisposerBag()).documents.getRenderedHtml();
    document.body.innerHTML = "";

    expect(html).toBe("<p>Hi</p>");
  });
});
