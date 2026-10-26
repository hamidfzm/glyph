import { describe, expect, it } from "vitest";
import type { RegistryEntry } from "@/lib/plugins/marketplace";
import type { InstalledPlugin } from "@/lib/plugins/types";
import type { SyncedPlugin } from "@/lib/settingsSync";
import { reconcilePlugins } from "./pluginReconcile";

function synced(id: string, overrides: Partial<SyncedPlugin> = {}): SyncedPlugin {
  return { id, source: "marketplace", version: "1.0.0", enabled: true, ...overrides };
}

function local(id: string): InstalledPlugin {
  return {
    id,
    name: id,
    version: "1.0.0",
    apiVersion: "^0.27.0",
    sandbox: true,
    dir: `/plugins/${id}`,
    mainSource: "",
  };
}

function entry(id: string): RegistryEntry {
  return {
    id,
    name: id,
    version: "2.0.0",
    apiVersion: "^0.27.0",
    packageUrl: `https://example.com/${id}.zip`,
    sha256: "0".repeat(64),
  };
}

describe("reconcilePlugins", () => {
  it("offers synced marketplace plugins missing here from the registry", () => {
    const result = reconcilePlugins(
      { plugins: [synced("a.a"), synced("b.b", { source: "unknown" })], removals: [] },
      [],
      [],
      [entry("a.a"), entry("b.b")],
    );
    expect(result.missing.map((e) => e.id)).toEqual(["a.a", "b.b"]);
    expect(result.manual).toEqual([]);
  });

  it("lists plugins from a folder, and ones the registry lacks, to install by hand", () => {
    const result = reconcilePlugins(
      { plugins: [synced("l.l", { source: "local" }), synced("gone.gone")], removals: [] },
      [],
      [],
      [entry("l.l")],
    );
    expect(result.missing).toEqual([]);
    expect(result.manual.map((m) => [m.plugin.id, m.reason])).toEqual([
      ["l.l", "local"],
      ["gone.gone", "unlisted"],
    ]);
  });

  it("matches the enabled state of plugins installed on both machines", () => {
    const result = reconcilePlugins(
      {
        plugins: [
          synced("on.there", { enabled: true }),
          synced("off.there", { enabled: false }),
          synced("same.same", { enabled: true }),
        ],
        removals: [],
      },
      [local("on.there"), local("off.there"), local("same.same")],
      ["on.there"],
      [],
    );
    expect(result.toEnable.map((p) => p.id)).toEqual(["on.there"]);
    expect(result.toDisable).toEqual(["off.there"]);
    expect(result.missing).toEqual([]);
  });

  it("removes only what is still installed", () => {
    const result = reconcilePlugins(
      { plugins: [], removals: ["x.x", "already.gone"] },
      [local("x.x")],
      [],
      [],
    );
    expect(result.removals).toEqual(["x.x"]);
  });
});
