import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import { vi } from "vitest";
import { usePluginsOptional } from "@/contexts/PluginsContext";
import { useRegistryEntries } from "@/hooks/usePluginRegistry";
import { PLUGIN_API_VERSION } from "@/lib/plugins/apiVersion";
import type { InstalledPlugin } from "@/lib/plugins/types";

// Shared fixtures for the PluginsProvider suites. Each of those files mocks
// "@/lib/pickers" and "@/lib/plugins/settingsStore" itself (vi.mock is
// per-module and hoisted) and calls resetPluginsMocks in its beforeEach.

// The fixture uses full-trust APIs (ctx.ui mounts), so it declares
// sandbox: false; grantedStore below pre-grants it full trust the way a real
// consented install would have.
export function installedPlugin(overrides: Partial<InstalledPlugin> = {}): InstalledPlugin {
  return {
    id: "com.x.demo",
    name: "Demo",
    version: "1.0.0",
    apiVersion: `^${PLUGIN_API_VERSION}`,
    sandbox: false,
    dir: "/plugins/com.x.demo",
    mainSource: `export default {
      activate(ctx) {
        ctx.commands.register({ id: "demo.hi", title: "Say Hi", run() {} });
        ctx.ui.addStatusBarItem({ id: "demo.item", mount(el) { el.textContent = "demo"; } });
      },
    };`,
    ...overrides,
  };
}

/** A plugins store whose grants cover the startup fixtures with full trust. */
export function grantedStore() {
  return {
    get: vi.fn((key: string) =>
      Promise.resolve(
        key === "grants"
          ? {
              "com.x.demo": { permissions: ["workspace:read"], fullTrust: true },
              "com.x.broken": { permissions: [], fullTrust: true },
            }
          : null,
      ),
    ),
    set: vi.fn((_key: string, _value: unknown) => Promise.resolve()),
  };
}

export function inspection(overrides: Record<string, unknown> = {}) {
  return {
    id: "com.x.new",
    name: "Fresh",
    version: "1.0.0",
    permissions: [],
    sandbox: false,
    ...overrides,
  };
}

/** Probe that surfaces the provider state for assertions. */
export function Probe() {
  const plugins = usePluginsOptional();
  const commands = useRegistryEntries(plugins?.commands ?? null);
  return (
    <div>
      <span data-testid="loaded">{plugins?.loaded.map((p) => p.id).join(",")}</span>
      <span data-testid="commands">{commands.map((c) => c.id).join(",")}</span>
      <span data-testid="initial-load">{String(plugins?.initialLoadDone)}</span>
    </div>
  );
}

/** Reset the Tauri store and marketplace fetch to the defaults the suites assume. */
export function resetPluginsMocks(): void {
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(undefined);
  vi.mocked(load).mockReset();
  vi.mocked(load).mockResolvedValue(grantedStore() as never);
  // The provider fetches the marketplace index on every mount; the global
  // setup stub answers ok: false, which would log a fetch failure in every
  // test. Serve an empty index instead; fetch-driven tests restub per case.
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ plugins: [] }) } as Response),
  ) as unknown as typeof fetch;
}
