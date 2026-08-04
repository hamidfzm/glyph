import { describe, expect, it, vi } from "vitest";
import { createPluginHost } from "@/lib/plugins/host";
import type { PluginModule } from "@/lib/plugins/types";
import { deferredImporterFor, importerFor, installed } from "@/test/fixtures/pluginHost";

describe("createPluginHost overlapping loads", () => {
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
});
