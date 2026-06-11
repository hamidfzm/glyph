import { describe, expect, it, vi } from "vitest";
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
});
