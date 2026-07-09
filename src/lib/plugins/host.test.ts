import { describe, expect, it, vi } from "vitest";
import { clearDictionarySources, getDictionarySource } from "@/lib/spellcheck/dictionarySources";
import { FakeWorker } from "@/test/fakeWorker";
import { PLUGIN_API_VERSION } from "./apiVersion";
import { createPluginHost } from "./host";
import type { ModuleImporter } from "./loader";
import type { InstalledPlugin, PluginModule } from "./types";

function installed(overrides: Partial<InstalledPlugin> = {}): InstalledPlugin {
  return {
    id: "com.x.demo",
    name: "Demo",
    version: "1.0.0",
    apiVersion: `^${PLUGIN_API_VERSION}`,
    dir: "/plugins/com.x.demo",
    mainSource: "export default …",
    ...overrides,
  };
}

/** An importer that yields the given module object, bypassing the data: import. */
function importerFor(module: PluginModule): ModuleImporter {
  return vi.fn().mockResolvedValue({ default: module });
}

/** An importer whose resolution the test controls, for overlap/race cases. */
function deferredImporterFor(module: PluginModule): {
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

describe("createPluginHost", () => {
  it("activates a plugin and exposes its contributions", async () => {
    const host = createPluginHost(vi.fn());
    const run = vi.fn();
    const module: PluginModule = {
      activate(ctx) {
        ctx.commands.register({ id: "c1", title: "Say hi", run });
        ctx.ui.addStatusBarItem({ id: "s1", mount: () => {} });
      },
    };

    await host.load(installed(), importerFor(module));

    expect(host.commands.list().map((c) => c.id)).toEqual(["c1"]);
    expect(host.statusBarItems.list().map((s) => s.id)).toEqual(["s1"]);
    expect(host.listLoaded()).toEqual([
      { id: "com.x.demo", name: "Demo", version: "1.0.0", description: undefined },
    ]);
  });

  it("unload removes exactly that plugin's contributions and calls deactivate", async () => {
    const host = createPluginHost(vi.fn());
    const deactivate = vi.fn();
    const moduleA: PluginModule = {
      activate(ctx) {
        ctx.commands.register({ id: "a", title: "A", run: () => {} });
      },
      deactivate,
    };
    const moduleB: PluginModule = {
      activate(ctx) {
        ctx.commands.register({ id: "b", title: "B", run: () => {} });
      },
    };

    await host.load(installed({ id: "p.a", name: "A" }), importerFor(moduleA));
    await host.load(installed({ id: "p.b", name: "B" }), importerFor(moduleB));
    host.unload("p.a");

    expect(host.commands.list().map((c) => c.id)).toEqual(["b"]);
    expect(deactivate).toHaveBeenCalledTimes(1);
    expect(host.listLoaded().map((p) => p.id)).toEqual(["p.b"]);
  });

  it("re-loading the same id replaces the previous instance", async () => {
    const host = createPluginHost(vi.fn());
    const make = (cmd: string): PluginModule => ({
      activate(ctx) {
        ctx.commands.register({ id: cmd, title: cmd, run: () => {} });
      },
    });

    await host.load(installed(), importerFor(make("v1")));
    await host.load(installed(), importerFor(make("v2")));

    expect(host.commands.list().map((c) => c.id)).toEqual(["v2"]);
    expect(host.listLoaded()).toHaveLength(1);
  });

  it("rejects a plugin whose apiVersion the host does not satisfy", async () => {
    const host = createPluginHost(vi.fn());
    await expect(
      host.load(installed({ apiVersion: "^99.0.0" }), importerFor({ activate: vi.fn() })),
    ).rejects.toThrow(/requires plugin API/);
    expect(host.listLoaded()).toHaveLength(0);
  });

  it("rolls back registrations when activate throws", async () => {
    const host = createPluginHost(vi.fn());
    const module: PluginModule = {
      activate(ctx) {
        ctx.commands.register({ id: "partial", title: "P", run: () => {} });
        throw new Error("activation failed");
      },
    };

    await expect(host.load(installed(), importerFor(module))).rejects.toThrow("activation failed");

    expect(host.commands.list()).toHaveLength(0);
    expect(host.listLoaded()).toHaveLength(0);
  });

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

  it("still unloads a plugin whose deactivate throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const host = createPluginHost(vi.fn());
    const module: PluginModule = {
      activate(ctx) {
        ctx.commands.register({ id: "c", title: "C", run: () => {} });
      },
      deactivate() {
        throw new Error("bad deactivate");
      },
    };

    await host.load(installed(), importerFor(module));
    host.unload("com.x.demo");

    expect(host.commands.list()).toHaveLength(0);
    expect(host.listLoaded()).toHaveLength(0);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
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
      },
    };

    await host.load(installed(), importerFor(module));

    expect(host.sidebarPanels.list().map((p) => p.title)).toEqual(["Side"]);
    // The host stamps the owning plugin id onto the settings panel.
    expect(host.settingsPanels.list().map((p) => p.pluginId)).toEqual(["com.x.demo"]);
    expect(host.styles.list().map((s) => s.css)).toEqual([".markdown-body { color: red }"]);
    expect(host.exporters.list().map((e) => e.id)).toEqual(["p.export"]);

    host.unload("com.x.demo");
    expect(host.sidebarPanels.list()).toHaveLength(0);
    expect(host.settingsPanels.list()).toHaveLength(0);
    expect(host.styles.list()).toHaveLength(0);
    expect(host.exporters.list()).toHaveLength(0);
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

  it("only the newest of two overlapping loads for one id commits; the stale one rolls back", async () => {
    const host = createPluginHost(vi.fn());
    const staleDeactivate = vi.fn();
    const stale: PluginModule = {
      activate(ctx) {
        ctx.commands.register({ id: "stale.cmd", title: "Stale", run: () => {} });
      },
      deactivate: staleDeactivate,
    };
    const fresh: PluginModule = {
      activate(ctx) {
        ctx.commands.register({ id: "fresh.cmd", title: "Fresh", run: () => {} });
      },
    };

    const first = deferredImporterFor(stale);
    const firstLoad = host.load(installed({ version: "1.0.0" }), first.importer);
    // Second load for the same id starts before the first resolves.
    await host.load(installed({ version: "2.0.0" }), importerFor(fresh));
    first.resolve();
    await firstLoad;

    expect(host.commands.list().map((c) => c.id)).toEqual(["fresh.cmd"]);
    expect(host.listLoaded().map((p) => p.version)).toEqual(["2.0.0"]);
    expect(staleDeactivate).toHaveBeenCalledTimes(1);
  });

  it("logs but survives when a superseded load's deactivate throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const host = createPluginHost(vi.fn());
    const stale: PluginModule = {
      activate() {},
      deactivate() {
        throw new Error("bad rollback");
      },
    };
    const fresh: PluginModule = { activate() {} };

    const first = deferredImporterFor(stale);
    const firstLoad = host.load(installed(), first.importer);
    await host.load(installed(), importerFor(fresh));
    first.resolve();
    await firstLoad;

    expect(host.listLoaded()).toHaveLength(1);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("a load resolving after unloadAll rolls back instead of leaking", async () => {
    const host = createPluginHost(vi.fn());
    const module: PluginModule = {
      activate(ctx) {
        ctx.commands.register({ id: "late.cmd", title: "Late", run: () => {} });
      },
    };
    const gate = deferredImporterFor(module);
    const pending = host.load(installed(), gate.importer);

    host.unloadAll();
    gate.resolve();
    await pending;

    expect(host.commands.list()).toHaveLength(0);
    expect(host.listLoaded()).toHaveLength(0);
  });

  it("can load again after unloadAll (StrictMode remount)", async () => {
    const host = createPluginHost(vi.fn());
    const make = (): PluginModule => ({
      activate(ctx) {
        ctx.commands.register({ id: "again.cmd", title: "Again", run: () => {} });
      },
    });

    await host.load(installed(), importerFor(make()));
    host.unloadAll();
    await host.load(installed(), importerFor(make()));

    expect(host.commands.list().map((c) => c.id)).toEqual(["again.cmd"]);
    expect(host.listLoaded()).toHaveLength(1);
  });

  it("unloadAll tears down every plugin", async () => {
    const host = createPluginHost(vi.fn());
    const make = (): PluginModule => ({
      activate(ctx) {
        ctx.ui.addStatusBarItem({ id: "i", mount: () => {} });
      },
    });
    await host.load(installed({ id: "p.a" }), importerFor(make()));
    await host.load(installed({ id: "p.b" }), importerFor(make()));

    host.unloadAll();

    expect(host.statusBarItems.list()).toHaveLength(0);
    expect(host.listLoaded()).toHaveLength(0);
  });

  describe("sandboxed plugins", () => {
    /** Spawner that captures the FakeWorker and auto-activates unless told not to. */
    const spawnerFor =
      (worker: FakeWorker, autoActivate = true) =>
      () => {
        if (autoActivate) queueMicrotask(() => worker.emit({ type: "activated" }));
        return worker;
      };
    const boxed = (overrides: Partial<InstalledPlugin> = {}) =>
      installed({ sandbox: true, ...overrides });

    it("loads via the worker instead of importing the module", async () => {
      const worker = new FakeWorker();
      const host = createPluginHost(vi.fn(), undefined, undefined, undefined, spawnerFor(worker));
      const importer = vi.fn();

      await host.load(boxed(), importer as unknown as ModuleImporter);

      expect(importer).not.toHaveBeenCalled();
      expect(host.listLoaded().map((p) => p.id)).toEqual(["com.x.demo"]);
      expect(worker.posted[0]).toMatchObject({ type: "init", source: "export default …" });
    });

    it("routes worker registrations into the registries and removes them on unload", async () => {
      const worker = new FakeWorker();
      const notify = vi.fn();
      const host = createPluginHost(notify, undefined, undefined, undefined, spawnerFor(worker));

      await host.load(boxed());
      worker.emit({ type: "register-command", id: "c1", title: "Boxed cmd" });
      worker.emit({ type: "add-styles", css: ".x{}" });
      worker.emit({ type: "register-exporter", id: "e1", label: "E", extension: "txt" });
      worker.emit({ type: "notify", message: "hi from box" });

      expect(host.commands.list().map((c) => c.id)).toEqual(["c1"]);
      expect(host.styles.list().map((s) => s.css)).toEqual([".x{}"]);
      expect(host.exporters.list().map((e) => e.id)).toEqual(["e1"]);
      expect(notify).toHaveBeenCalledWith("hi from box");

      host.unload("com.x.demo");
      expect(host.commands.list()).toHaveLength(0);
      expect(host.styles.list()).toHaveLength(0);
      expect(host.exporters.list()).toHaveLength(0);
      expect(worker.terminated).toBe(true);
    });

    it("persists settings-set through the backend, merged over hydrated values", async () => {
      const worker = new FakeWorker();
      const backend = { load: vi.fn().mockResolvedValue({ size: 12 }), save: vi.fn() };
      const host = createPluginHost(vi.fn(), undefined, undefined, backend, spawnerFor(worker));

      await host.load(boxed());
      // Snapshot before settings-set: the host hands the worker the hydrated object.
      expect((worker.posted[0] as { settings: unknown }).settings).toEqual({ size: 12 });

      worker.emit({ type: "settings-set", key: "theme", value: "dark" });
      expect(backend.save).toHaveBeenCalledWith("com.x.demo", { size: 12, theme: "dark" });
    });

    it("routes translations and answers workspace calls with permission gating", async () => {
      const worker = new FakeWorker();
      const translations = vi.fn();
      const host = createPluginHost(
        vi.fn(),
        translations,
        () => null,
        undefined,
        spawnerFor(worker),
      );

      await host.load(boxed({ permissions: ["workspace:read"] }));
      worker.emit({ type: "register-translations", locale: "fa", namespace: "n", resources: {} });
      worker.emit({ type: "workspace-list", callId: 1 });

      expect(translations).toHaveBeenCalledWith("fa", "n", {});
      // workspace:read granted but no workspace open: an error result, not a hang.
      await vi.waitFor(() =>
        expect(worker.posted).toContainEqual(
          expect.objectContaining({ type: "workspace-result", callId: 1, ok: false }),
        ),
      );
    });

    it("propagates activation errors and loads nothing", async () => {
      const worker = new FakeWorker();
      const spawn = () => {
        queueMicrotask(() => worker.emit({ type: "error", message: "broken plugin" }));
        return worker;
      };
      const host = createPluginHost(vi.fn(), undefined, undefined, undefined, spawn);

      await expect(host.load(boxed())).rejects.toThrow("broken plugin");
      expect(host.listLoaded()).toHaveLength(0);
      expect(worker.terminated).toBe(true);
    });

    it("a sandbox load resolving after unloadAll rolls back and terminates", async () => {
      const worker = new FakeWorker();
      let activate!: () => void;
      const spawn = () => {
        activate = () => worker.emit({ type: "activated" });
        return worker;
      };
      const host = createPluginHost(vi.fn(), undefined, undefined, undefined, spawn);

      const pending = host.load(boxed());
      // Let the load progress to spawning the worker, then tear down before activation.
      await vi.waitFor(() => expect(activate).toBeDefined());
      host.unloadAll();
      activate();
      await pending;

      expect(host.listLoaded()).toHaveLength(0);
      expect(worker.terminated).toBe(true);
    });
  });
});

describe("spellcheck dictionary contributions", () => {
  it("registers through the plugin's bag and unload removes the dictionary", async () => {
    clearDictionarySources();
    const host = createPluginHost(vi.fn());
    const module: PluginModule = {
      activate(ctx) {
        ctx.spellcheck.registerDictionary({
          language: "fa",
          label: "Persian",
          load: () => Promise.resolve({ aff: "AFF", dic: "DIC" }),
        });
      },
    };

    await host.load(installed(), importerFor(module));
    expect(getDictionarySource("fa")?.label).toBe("Persian");

    host.unload("com.x.demo");
    expect(getDictionarySource("fa")).toBeUndefined();
  });
});
