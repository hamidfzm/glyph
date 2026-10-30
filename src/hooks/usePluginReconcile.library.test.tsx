import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PluginsProvider } from "@/contexts/PluginsProvider";
import type { PluginPlan } from "@/lib/settingsSync";
import { expectConsole } from "@/test/consoleGuard";
import { installedPlugin, Probe, resetPluginsMocks } from "@/test/pluginsHarness";
import { usePluginReconcile } from "./usePluginReconcile";

// The synced setup's plugins through the real plugin library: whatever the
// repo says, an install asks this machine for consent, and a full-trust
// plugin is never turned on without it.

vi.mock("@/lib/pickers", () => ({ pickPluginDir: vi.fn() }));
vi.mock("@/hooks/useCorePlugins", () => ({ useCorePlugins: () => true }));
vi.mock("@/lib/plugins/settingsStore", () => ({
  loadPluginSettings: vi.fn(() => Promise.resolve({})),
  savePluginSetting: vi.fn(() => Promise.resolve()),
}));

const ENTRY = {
  id: "com.x.synced",
  name: "Synced",
  version: "1.0.0",
  apiVersion: "^0.27.0",
  packageUrl: "https://example.com/synced.zip",
  sha256: "a".repeat(64),
};

function Reconciler({ plan }: { plan: PluginPlan }) {
  const { reconciliation, install } = usePluginReconcile(plan);
  return (
    <div>
      <span data-testid="missing">{reconciliation.missing.map((e) => e.id).join(",")}</span>
      <span data-testid="to-enable">{reconciliation.toEnable.map((p) => p.id).join(",")}</span>
      <button type="button" onClick={() => void install(ENTRY.id)}>
        install
      </button>
    </div>
  );
}

function plan(id: string): PluginPlan {
  return {
    plugins: [{ id, source: "marketplace", version: "1.0.0", enabled: true }],
    removals: [],
  };
}

function renderWith(installed: ReturnType<typeof installedPlugin>[], value: PluginPlan) {
  vi.mocked(invoke).mockImplementation((cmd) =>
    Promise.resolve(cmd === "list_plugins" ? installed : undefined),
  );
  render(
    <PluginsProvider>
      <Reconciler plan={value} />
      <Probe />
    </PluginsProvider>,
  );
}

beforeEach(() => {
  resetPluginsMocks();
  vi.mocked(ask).mockReset();
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ plugins: [ENTRY] }) } as Response),
  ) as unknown as typeof fetch;
});

describe("usePluginReconcile with the plugin library", () => {
  it("installs nothing when this machine refuses consent", async () => {
    vi.mocked(ask).mockResolvedValue(false);
    renderWith([], plan(ENTRY.id));
    await waitFor(() => expect(screen.getByTestId("missing")).toHaveTextContent(ENTRY.id));

    fireEvent.click(screen.getByRole("button", { name: "install" }));
    await waitFor(() => expect(ask).toHaveBeenCalled());
    expect(invoke).not.toHaveBeenCalledWith("install_plugin_from_registry", { id: ENTRY.id });
    expect(screen.getByTestId("missing")).toHaveTextContent(ENTRY.id);
  });

  it("keeps a plugin missing when its package does not match the registry", async () => {
    expectConsole(/Plugin operation failed/);
    vi.mocked(ask).mockResolvedValue(true);
    renderWith([], plan(ENTRY.id));
    vi.mocked(invoke).mockImplementation((cmd) => {
      if (cmd === "install_plugin_from_registry") {
        return Promise.reject(new Error("package hash does not match the registry"));
      }
      return Promise.resolve(cmd === "list_plugins" ? [] : undefined);
    });
    await waitFor(() => expect(screen.getByTestId("missing")).toHaveTextContent(ENTRY.id));

    fireEvent.click(screen.getByRole("button", { name: "install" }));
    expect(await screen.findByRole("status")).toHaveTextContent("hash does not match");
    expect(screen.getByTestId("missing")).toHaveTextContent(ENTRY.id);
  });

  it("leaves a full-trust plugin off until this machine approves it", async () => {
    const trusted = installedPlugin({ id: "com.x.trusted", sandbox: false });
    renderWith([trusted], plan(trusted.id));
    // Without a grant here, the library parks it, and the synced "on" waits
    // for the user instead of opening the full-access prompt on its own.
    await waitFor(() => expect(screen.getByTestId("to-enable")).toHaveTextContent(trusted.id));
    expect(ask).not.toHaveBeenCalled();
    expect(screen.getByTestId("loaded")).not.toHaveTextContent(trusted.id);
  });
});
