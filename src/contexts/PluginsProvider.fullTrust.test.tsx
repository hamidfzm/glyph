import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { load } from "@tauri-apps/plugin-store";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePluginsOptional } from "@/contexts/PluginsContext";
import { PluginsProvider } from "@/contexts/PluginsProvider";
import { PLUGIN_API_VERSION } from "@/lib/plugins/apiVersion";
import { installedPlugin, Probe, resetPluginsMocks } from "@/test/pluginsHarness";

vi.mock("@/lib/pickers", () => ({
  pickPluginDir: vi.fn(),
}));

vi.mock("@/lib/plugins/settingsStore", () => ({
  loadPluginSettings: vi.fn(() => Promise.resolve({})),
  savePluginSettings: vi.fn(() => Promise.resolve()),
}));

beforeEach(resetPluginsMocks);

describe("PluginsProvider full-trust plugins", () => {
  it("parks an ungranted full-trust plugin disabled at startup and re-enables through the warning", async () => {
    const store = {
      get: vi.fn(() => Promise.resolve(null)),
      set: vi.fn((_key: string, _value: unknown) => Promise.resolve()),
    };
    vi.mocked(load).mockResolvedValue(store as never);
    vi.mocked(invoke).mockImplementation((cmd) =>
      Promise.resolve(cmd === "list_plugins" ? [installedPlugin()] : undefined),
    );
    vi.mocked(ask).mockClear();

    function ManageProbe() {
      const p = usePluginsOptional();
      if (!p) return null;
      return (
        <div>
          <span data-testid="loaded">{p.loaded.map((x) => x.id).join(",")}</span>
          <span data-testid="disabled">{p.disabled.join(",")}</span>
          <button type="button" onClick={() => void p.setEnabled("com.x.demo", true)}>
            on
          </button>
        </div>
      );
    }

    render(
      <PluginsProvider>
        <ManageProbe />
      </PluginsProvider>,
    );

    // No persisted full-trust grant: installed but parked disabled, not loaded.
    // Parking is session state only; the user's saved disabled list is not
    // rewritten, so a transient grants read failure cannot stick.
    await waitFor(() => expect(screen.getByTestId("disabled")).toHaveTextContent("com.x.demo"));
    expect(screen.getByTestId("loaded").textContent).toBe("");
    expect(vi.mocked(ask)).not.toHaveBeenCalled();
    expect(store.set).not.toHaveBeenCalled();

    // Enabling routes through the full-trust warning and persists the grant.
    screen.getByRole("button", { name: "on" }).click();
    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("com.x.demo"));
    const [message] = vi.mocked(ask).mock.calls.at(-1) ?? [];
    expect(message).toContain("WITHOUT the plugin sandbox");
    expect(store.set).toHaveBeenCalledWith(
      "grants",
      expect.objectContaining({ "com.x.demo": expect.objectContaining({ fullTrust: true }) }),
    );
  });

  it("keeps a parked full-trust plugin off when the enable warning is declined", async () => {
    const store = {
      get: vi.fn(() => Promise.resolve(null)),
      set: vi.fn((_key: string, _value: unknown) => Promise.resolve()),
    };
    vi.mocked(load).mockResolvedValue(store as never);
    vi.mocked(invoke).mockImplementation((cmd) =>
      Promise.resolve(cmd === "list_plugins" ? [installedPlugin()] : undefined),
    );
    vi.mocked(ask).mockClear();
    vi.mocked(ask).mockResolvedValueOnce(false);

    function ManageProbe() {
      const p = usePluginsOptional();
      if (!p) return null;
      return (
        <div>
          <span data-testid="loaded">{p.loaded.map((x) => x.id).join(",")}</span>
          <span data-testid="disabled">{p.disabled.join(",")}</span>
          <button type="button" onClick={() => void p.setEnabled("com.x.demo", true)}>
            on
          </button>
        </div>
      );
    }

    render(
      <PluginsProvider>
        <ManageProbe />
      </PluginsProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("disabled")).toHaveTextContent("com.x.demo"));

    screen.getByRole("button", { name: "on" }).click();

    await waitFor(() => expect(vi.mocked(ask)).toHaveBeenCalled());
    expect(screen.getByTestId("loaded").textContent).toBe("");
    expect(screen.getByTestId("disabled")).toHaveTextContent("com.x.demo");
    expect(store.set).not.toHaveBeenCalledWith("grants", expect.anything());
  });

  it("shows the full-trust warning for a registry entry that opts out of the sandbox", async () => {
    vi.mocked(invoke).mockImplementation((cmd) =>
      Promise.resolve(cmd === "list_plugins" ? [] : undefined),
    );
    vi.mocked(ask).mockClear();
    vi.mocked(ask).mockResolvedValueOnce(false);
    const entry = {
      id: "com.x.trusty",
      name: "Trusty",
      version: "1.0.0",
      apiVersion: `^${PLUGIN_API_VERSION}`,
      sandbox: false,
      packageUrl: "https://example.test/plugin.zip",
      sha256: "a".repeat(64),
    };

    function InstallProbe() {
      const plugins = usePluginsOptional();
      return (
        <button type="button" onClick={() => void plugins?.installFromRegistry(entry)}>
          market
        </button>
      );
    }

    render(
      <PluginsProvider>
        <InstallProbe />
        <Probe />
      </PluginsProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("initial-load")).toHaveTextContent("true"));
    screen.getByRole("button", { name: "market" }).click();

    await waitFor(() => expect(vi.mocked(ask)).toHaveBeenCalled());
    const [message] = vi.mocked(ask).mock.calls.at(-1) ?? [];
    expect(message).toContain("WITHOUT the plugin sandbox");
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("install_plugin_package", expect.anything());
  });

  it("loads sandboxed plugins without a grant and uninstalls them without touching grants", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = {
      get: vi.fn(() => Promise.resolve(null)),
      set: vi.fn((_key: string, _value: unknown) => Promise.resolve()),
    };
    vi.mocked(load).mockResolvedValue(store as never);
    // Sandboxed plugin: never parked at startup (jsdom has no Worker, so the
    // load itself fails, which is fine; the gate must not have blocked it).
    vi.mocked(invoke).mockImplementation((cmd) =>
      Promise.resolve(cmd === "list_plugins" ? [installedPlugin({ sandbox: true })] : undefined),
    );

    function ManageProbe() {
      const p = usePluginsOptional();
      if (!p) return null;
      return (
        <div>
          <span data-testid="installed">{p.installed.map((x) => x.id).join(",")}</span>
          <span data-testid="disabled">{p.disabled.join(",")}</span>
          <button type="button" onClick={() => void p.uninstall("com.x.demo")}>
            rm
          </button>
        </div>
      );
    }

    render(
      <PluginsProvider>
        <ManageProbe />
      </PluginsProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("installed")).toHaveTextContent("com.x.demo"));
    expect(screen.getByTestId("disabled").textContent).toBe("");

    // No grant was ever recorded, so uninstall has nothing to revoke.
    screen.getByRole("button", { name: "rm" }).click();
    await waitFor(() => expect(screen.getByTestId("installed").textContent).toBe(""));
    expect(store.set).not.toHaveBeenCalledWith("grants", expect.anything());
    spy.mockRestore();
  });
});
