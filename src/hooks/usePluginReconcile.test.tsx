import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { PluginsContext, type PluginsContextValue } from "@/contexts/PluginsContext";
import type { RegistryEntry } from "@/lib/plugins/marketplace";
import type { InstalledPlugin } from "@/lib/plugins/types";
import type { PluginPlan } from "@/lib/settingsSync";
import { usePluginReconcile } from "./usePluginReconcile";

function entry(id: string): RegistryEntry {
  return {
    id,
    name: id,
    version: "1.0.0",
    apiVersion: "^0.27.0",
    packageUrl: `https://example.com/${id}.zip`,
    sha256: "0".repeat(64),
  };
}

function installed(id: string): InstalledPlugin {
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

function library(overrides: Partial<PluginsContextValue> = {}): PluginsContextValue {
  return {
    installed: [],
    disabled: [],
    registry: [],
    initialLoadDone: true,
    installFromRegistry: vi.fn(() => Promise.resolve()),
    setEnabled: vi.fn(() => Promise.resolve()),
    uninstall: vi.fn(() => Promise.resolve()),
    ...overrides,
  } as unknown as PluginsContextValue;
}

function renderReconcile(plan: PluginPlan, value: PluginsContextValue | null) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PluginsContext.Provider value={value}>{children}</PluginsContext.Provider>
  );
  return renderHook((p: PluginPlan) => usePluginReconcile(p), { wrapper, initialProps: plan });
}

const synced = (id: string, enabled = true) => ({
  id,
  source: "marketplace" as const,
  version: "1.0.0",
  enabled,
});

describe("usePluginReconcile", () => {
  it("installs a missing plugin through the library, which asks for consent", async () => {
    const value = library({ registry: [entry("a.a")] });
    const { result } = renderReconcile({ plugins: [synced("a.a")], removals: [] }, value);
    expect(result.current.reconciliation.missing.map((e) => e.id)).toEqual(["a.a"]);
    await act(() => result.current.install("a.a"));
    expect(value.installFromRegistry).toHaveBeenCalledWith(entry("a.a"));
    await act(() => result.current.install("not.missing"));
    expect(value.installFromRegistry).toHaveBeenCalledTimes(1);
  });

  it("installs every missing plugin one at a time", async () => {
    const order: string[] = [];
    let finishFirst: () => void = () => {};
    const installFromRegistry = vi.fn(
      (e: RegistryEntry) =>
        new Promise<void>((resolve) => {
          order.push(`start ${e.id}`);
          const done = () => {
            order.push(`end ${e.id}`);
            resolve();
          };
          if (e.id === "a.a") finishFirst = done;
          else done();
        }),
    );
    const value = library({ registry: [entry("a.a"), entry("b.b")], installFromRegistry });
    const { result } = renderReconcile(
      { plugins: [synced("a.a"), synced("b.b")], removals: [] },
      value,
    );
    let all: Promise<void> = Promise.resolve();
    act(() => {
      all = result.current.installAll();
    });
    expect(result.current.pendingId).toBe("a.a");
    expect(order).toEqual(["start a.a"]);
    await act(async () => {
      finishFirst();
      await all;
    });
    expect(order).toEqual(["start a.a", "end a.a", "start b.b", "end b.b"]);
    expect(result.current.pendingId).toBeNull();
  });

  it("applies removals and plugins turned off elsewhere once per plan", () => {
    const uninstall = vi.fn(() => Promise.resolve());
    const setEnabled = vi.fn(() => Promise.resolve());
    let value = library({
      installed: [installed("gone.gone"), installed("off.off")],
      uninstall,
      setEnabled,
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PluginsContext.Provider value={value}>{children}</PluginsContext.Provider>
    );
    const plan = { plugins: [synced("off.off", false)], removals: ["gone.gone"] };
    const { rerender } = renderHook((p: PluginPlan) => usePluginReconcile(p), {
      wrapper,
      initialProps: plan,
    });
    // The library re-renders while the uninstall runs: nothing starts twice.
    value = { ...value, installed: [installed("gone.gone"), installed("off.off")] };
    rerender(plan);
    expect(uninstall).toHaveBeenCalledTimes(1);
    expect(uninstall).toHaveBeenCalledWith("gone.gone");
    expect(setEnabled).toHaveBeenCalledTimes(1);
    expect(setEnabled).toHaveBeenCalledWith("off.off", false);

    // The same plan read again, as after every sync, starts nothing twice.
    rerender({ ...plan });
    expect(uninstall).toHaveBeenCalledTimes(1);
    // Once no plan asks for it, a later one that does starts it again.
    rerender({ plugins: [], removals: [] });
    rerender({ ...plan });
    expect(uninstall).toHaveBeenCalledTimes(2);
    expect(setEnabled).toHaveBeenCalledTimes(2);
  });

  it("waits for a click to turn on a plugin, since that may ask for consent", async () => {
    const value = library({ installed: [installed("on.on")], disabled: ["on.on"] });
    const { result } = renderReconcile({ plugins: [synced("on.on")], removals: [] }, value);
    expect(value.setEnabled).not.toHaveBeenCalled();
    expect(result.current.reconciliation.toEnable.map((p) => p.id)).toEqual(["on.on"]);
    await act(() => result.current.enable("on.on"));
    expect(value.setEnabled).toHaveBeenCalledWith("on.on", true);
  });

  it("does nothing before the plugins loaded, or without a plugin library", async () => {
    const plan = { plugins: [synced("a.a")], removals: ["x.x"] };
    const early = library({
      initialLoadDone: false,
      installed: [installed("x.x")],
      registry: [entry("a.a")],
    });
    expect(renderReconcile(plan, early).result.current.reconciliation.missing).toEqual([]);
    expect(early.uninstall).not.toHaveBeenCalled();

    const { result } = renderReconcile(plan, null);
    await act(async () => {
      await result.current.install("a.a");
      await result.current.installAll();
      await result.current.enable("a.a");
    });
    expect(result.current.reconciliation.missing).toEqual([]);
  });
});
