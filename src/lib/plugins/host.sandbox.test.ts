import { describe, expect, it, vi } from "vitest";
import { createPluginHost } from "@/lib/plugins/host";
import type { ModuleImporter } from "@/lib/plugins/loader";
import type { InstalledPlugin, PluginModule } from "@/lib/plugins/types";
import { clearDictionarySources, getDictionarySource } from "@/lib/spellcheck/dictionarySources";
import { FakeWorker } from "@/test/fakeWorker";
import { importerFor, installed } from "@/test/fixtures/pluginHost";

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
    worker.emit({ type: "register-site-theme", id: "t1", label: "T", css: "body{}" });
    worker.emit({ type: "notify", message: "hi from box" });

    expect(host.commands.list().map((c) => c.id)).toEqual(["c1"]);
    expect(host.styles.list().map((s) => s.css)).toEqual([".x{}"]);
    expect(host.exporters.list().map((e) => e.id)).toEqual(["e1"]);
    expect(host.siteThemes.list().map((t) => t.id)).toEqual(["t1"]);
    expect(notify).toHaveBeenCalledWith("hi from box");

    host.unload("com.x.demo");
    expect(host.commands.list()).toHaveLength(0);
    expect(host.styles.list()).toHaveLength(0);
    expect(host.exporters.list()).toHaveLength(0);
    expect(host.siteThemes.list()).toHaveLength(0);
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
    const host = createPluginHost(vi.fn(), translations, () => null, undefined, spawnerFor(worker));

    await host.load(boxed({ permissions: ["workspace:read"] }));
    worker.emit({ type: "register-translations", locale: "fa", namespace: "n", resources: {} });
    worker.emit({ type: "workspace-list", callId: 1 });

    expect(translations).toHaveBeenCalledWith("fa", "n", {});
    // workspace:read granted but no workspace open: an error result, not a hang.
    await vi.waitFor(() =>
      expect(worker.posted).toContainEqual(
        expect.objectContaining({ type: "host-result", callId: 1, ok: false }),
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
