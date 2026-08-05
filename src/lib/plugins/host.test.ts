import { describe, expect, it, vi } from "vitest";
import { PLUGIN_API_COMPAT_FLOOR, PLUGIN_API_VERSION } from "@/lib/plugins/apiVersion";
import { createPluginHost } from "@/lib/plugins/host";
import type { PluginModule } from "@/lib/plugins/types";
import { importerFor, installed } from "@/test/fixtures/pluginHost";

describe("createPluginHost lifecycle", () => {
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

  it("loads a plugin declaring an older version inside the compatibility window", async () => {
    // Pins the published-plugin guarantee: marketplace plugins pinned to the
    // floor version keep loading after additive host bumps, no republish.
    const host = createPluginHost(vi.fn());
    const module: PluginModule = {
      activate(ctx) {
        ctx.commands.register({ id: "old-but-compatible", title: "Old", run: () => {} });
      },
    };

    await host.load(installed({ apiVersion: PLUGIN_API_COMPAT_FLOOR }), importerFor(module));

    expect(host.commands.list().map((c) => c.id)).toEqual(["old-but-compatible"]);
  });

  it("rejects a below-floor plugin naming the accepted range", async () => {
    const host = createPluginHost(vi.fn());
    await expect(
      host.load(installed({ apiVersion: "0.15.0" }), importerFor({ activate: () => {} })),
    ).rejects.toThrow(`accepts ${PLUGIN_API_COMPAT_FLOOR} through ${PLUGIN_API_VERSION}`);
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
