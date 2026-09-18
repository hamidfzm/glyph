import { describe, expect, it, vi } from "vitest";
import { i18n } from "@/lib/i18n";
import { fileTypeFor } from "@/lib/plugins/fileTypes";
import { createPluginHost } from "@/lib/plugins/host";
import { staticRendererFor } from "@/lib/plugins/staticRenderers";
import type { PluginModule } from "@/lib/plugins/types";
import { importerFor, installed } from "@/test/fixtures/pluginHost";

describe("createPluginHost plugin context", () => {
  it("registers markdown contributions and removes them on unload", async () => {
    const host = createPluginHost(vi.fn());
    const remark = vi.fn();
    const Render = () => null;
    const module: PluginModule = {
      activate(ctx) {
        ctx.markdown.registerRemarkPlugin(remark);
        ctx.markdown.registerFencedRenderer("d2", Render);
      },
    };

    await host.load(installed(), importerFor(module));
    expect(host.remarkPlugins.list()).toEqual([remark]);
    expect(host.fencedRenderers.list()).toEqual([{ language: "d2", render: Render }]);

    host.unload("com.x.demo");
    expect(host.remarkPlugins.list()).toHaveLength(0);
    expect(host.fencedRenderers.list()).toHaveLength(0);
  });

  it("registers file types and static renders, and removes them on unload", async () => {
    const host = createPluginHost(vi.fn());
    const renderStatic = async () => "<svg></svg>";
    const module: PluginModule = {
      activate(ctx) {
        ctx.documents.registerFileType({ extensions: ["d2"], language: "d2" });
        ctx.markdown.registerFencedRenderer("d2", () => null, { renderStatic });
      },
    };

    await host.load(installed(), importerFor(module));
    expect(fileTypeFor("/p/a.d2")?.language).toBe("d2");
    expect(staticRendererFor("d2")).toBe(renderStatic);

    host.unload("com.x.demo");
    expect(fileTypeFor("/p/a.d2")).toBeUndefined();
    expect(staticRendererFor("d2")).toBeUndefined();
  });

  it("removes a fenced renderer and its static render together through the returned disposer", async () => {
    const host = createPluginHost(vi.fn());
    let dispose = () => {};
    const module: PluginModule = {
      activate(ctx) {
        dispose = ctx.markdown.registerFencedRenderer("d2", () => null, {
          renderStatic: async () => "",
        });
      },
    };

    await host.load(installed(), importerFor(module));
    dispose();
    expect(host.fencedRenderers.list()).toHaveLength(0);
    expect(staticRendererFor("d2")).toBeUndefined();
    host.unload("com.x.demo");
  });

  it("reads registered translations and stops following the language after unload", async () => {
    const host = createPluginHost(vi.fn());
    const listener = vi.fn();
    let translated = "";
    const module: PluginModule = {
      activate(ctx) {
        i18n.addResourceBundle("en", "com.x.demo", { hello: "Hello {{name}}" });
        translated = ctx.i18n.t("com.x.demo:hello", { name: "Ada" });
        ctx.i18n.onLanguageChange(listener);
      },
    };

    await host.load(installed(), importerFor(module));
    expect(translated).toBe("Hello Ada");

    const language = i18n.language;
    await i18n.changeLanguage("de");
    expect(listener).toHaveBeenCalledTimes(1);

    host.unload("com.x.demo");
    await i18n.changeLanguage(language);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("routes ctx.notify to the host notifier", async () => {
    const notify = vi.fn();
    const host = createPluginHost(notify);
    const module: PluginModule = {
      activate(ctx) {
        ctx.notify("hello");
      },
    };

    await host.load(installed(), importerFor(module));

    expect(notify).toHaveBeenCalledWith("hello");
  });

  it("exposes sidebar panels, settings panels, styles, and exporters; unload removes them", async () => {
    const host = createPluginHost(vi.fn());
    const module: PluginModule = {
      activate(ctx) {
        ctx.ui.addSidebarPanel({ id: "p.side", title: "Side", mount: () => {} });
        ctx.ui.addSettingsPanel({ id: "p.settings", mount: () => {} });
        ctx.ui.addStyles(".markdown-body { color: red }");
        ctx.exporters.register({
          id: "p.export",
          label: "Thing",
          extension: "txt",
          build: async () => "out",
        });
        ctx.exporters.registerSiteTheme({
          id: "p.theme",
          label: "Theme",
          css: "body { background: beige }",
        });
      },
    };

    await host.load(installed(), importerFor(module));

    expect(host.sidebarPanels.list().map((p) => p.title)).toEqual(["Side"]);
    // The host stamps the owning plugin id onto the settings panel.
    expect(host.settingsPanels.list().map((p) => p.pluginId)).toEqual(["com.x.demo"]);
    expect(host.styles.list().map((s) => s.css)).toEqual([".markdown-body { color: red }"]);
    expect(host.exporters.list().map((e) => e.id)).toEqual(["p.export"]);
    expect(host.siteThemes.list().map((t) => t.id)).toEqual(["p.theme"]);

    host.unload("com.x.demo");
    expect(host.sidebarPanels.list()).toHaveLength(0);
    expect(host.settingsPanels.list()).toHaveLength(0);
    expect(host.styles.list()).toHaveLength(0);
    expect(host.exporters.list()).toHaveLength(0);
    expect(host.siteThemes.list()).toHaveLength(0);
  });

  it("hydrates ctx.settings before activate and persists set() through the backend", async () => {
    const save = vi.fn();
    const backend = {
      load: vi.fn().mockResolvedValue({ size: 12 }),
      save,
    };
    const host = createPluginHost(vi.fn(), undefined, undefined, backend);
    let seen: unknown;
    const module: PluginModule = {
      activate(ctx) {
        seen = ctx.settings.get("size");
        ctx.settings.set("size", 14);
        ctx.settings.set("theme", "dark");
      },
    };

    await host.load(installed(), importerFor(module));

    expect(backend.load).toHaveBeenCalledWith("com.x.demo");
    expect(seen).toBe(12);
    expect(save).toHaveBeenLastCalledWith("com.x.demo", { size: 14, theme: "dark" });
  });

  it("routes ctx.registerTranslations to the injected i18n hook", async () => {
    const register = vi.fn();
    const host = createPluginHost(vi.fn(), register);
    const module: PluginModule = {
      activate(ctx) {
        ctx.registerTranslations("de", "myplugin", { hello: "Hallo" });
      },
    };

    await host.load(installed(), importerFor(module));

    expect(register).toHaveBeenCalledWith("de", "myplugin", { hello: "Hallo" });
  });

  it("defaults ctx.workspace to no-workspace-open when no root getter is supplied", async () => {
    const host = createPluginHost(vi.fn());
    let error: unknown;
    const module: PluginModule = {
      async activate(ctx) {
        error = await ctx.workspace.listFiles().catch((e: unknown) => e);
      },
    };

    await host.load(installed({ permissions: ["workspace:read"] }), importerFor(module));

    expect(String(error)).toMatch(/no workspace/);
  });

  it("gates ctx.workspace on the plugin's declared permissions", async () => {
    const host = createPluginHost(vi.fn(), undefined, () => "/ws");
    let denied: unknown;
    let allowedCall: Promise<string[]> | undefined;
    const withPermission: PluginModule = {
      activate(ctx) {
        allowedCall = ctx.workspace.listFiles();
        allowedCall.catch(() => {}); // resolved via mocked invoke in tests
      },
    };
    const withoutPermission: PluginModule = {
      async activate(ctx) {
        denied = await ctx.workspace.listFiles().catch((e: unknown) => e);
      },
    };

    await host.load(
      installed({ id: "p.allowed", permissions: ["workspace:read"] }),
      importerFor(withPermission),
    );
    await host.load(installed({ id: "p.denied" }), importerFor(withoutPermission));

    expect(allowedCall).toBeDefined();
    expect(denied).toBeInstanceOf(Error);
    expect(String(denied)).toMatch(/workspace:read/);
  });
});
