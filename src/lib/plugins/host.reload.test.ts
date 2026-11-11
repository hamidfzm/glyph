import { describe, expect, it, vi } from "vitest";
import { createPluginHost } from "@/lib/plugins/host";
import type { PluginModule } from "@/lib/plugins/types";
import { expectConsole } from "@/test/consoleGuard";
import { deferredImporterFor, importerFor, installed } from "@/test/fixtures/pluginHost";

// A settings sync rewrites plugins.json under loaded plugins; reloading them
// is how each one reads its new settings.

describe("PluginHost.reload", () => {
  it("loads a plugin again with the settings stored now", async () => {
    let stored: Record<string, unknown> = { size: 12 };
    const backend = { load: vi.fn(async () => ({ ...stored })), save: vi.fn() };
    const host = createPluginHost(vi.fn(), undefined, undefined, backend);
    const seen: unknown[] = [];
    const deactivate = vi.fn();
    const module: PluginModule = {
      activate(ctx) {
        seen.push(ctx.settings.get("size"));
      },
      deactivate,
    };
    await host.load(installed(), importerFor(module));

    stored = { size: 20 };
    await host.reload(["com.x.demo", "com.x.not-loaded"]);

    expect(seen).toEqual([12, 20]);
    expect(deactivate).toHaveBeenCalledTimes(1);
    expect(host.listLoaded().map((p) => p.id)).toEqual(["com.x.demo"]);
  });

  it("reports a plugin that fails to come back and goes on with the rest", async () => {
    expectConsole(/com\.x\.demo failed to reload/);
    const host = createPluginHost(vi.fn());
    let calls = 0;
    const failing: PluginModule = {
      activate() {
        calls += 1;
        if (calls > 1) throw new Error("boom");
      },
    };
    const other = vi.fn();
    await host.load(installed(), importerFor(failing));
    await host.load(installed({ id: "com.x.other" }), importerFor({ activate: other }));

    await host.reload(["com.x.demo", "com.x.other"]);

    expect(other).toHaveBeenCalledTimes(2);
  });

  it("leaves a plugin alone while a newer load of it is in flight", async () => {
    const host = createPluginHost(vi.fn());
    const v1 = vi.fn();
    await host.load(installed(), importerFor({ activate: v1 }));
    const v2 = vi.fn();
    const update = deferredImporterFor({ activate: v2 });
    const landing = host.load(installed({ version: "2.0.0" }), update.importer);

    await host.reload(["com.x.demo"]);
    update.resolve();
    expect(await landing).toBe(true);

    expect(v1).toHaveBeenCalledTimes(1);
    expect(v2).toHaveBeenCalledTimes(1);
    expect(host.listLoaded()[0].version).toBe("2.0.0");
  });
});
