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

describe("PluginsProvider grants and updates", () => {
  it("asks fresh consent listing only the new permissions when an update expands them", async () => {
    const store = {
      get: vi.fn((key: string) =>
        Promise.resolve(
          key === "grants"
            ? { "com.x.market": { permissions: ["workspace:read"], fullTrust: false } }
            : null,
        ),
      ),
      set: vi.fn((_key: string, _value: unknown) => Promise.resolve()),
    };
    vi.mocked(load).mockResolvedValue(store as never);
    vi.mocked(invoke).mockImplementation((cmd) =>
      Promise.resolve(cmd === "list_plugins" ? [] : undefined),
    );
    vi.mocked(ask).mockClear();
    vi.mocked(ask).mockResolvedValueOnce(false);
    const entry = {
      id: "com.x.market",
      name: "Market",
      version: "2.0.0",
      apiVersion: `^${PLUGIN_API_VERSION}`,
      permissions: ["workspace:read", "network:api.example.com"],
      sandbox: true,
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
    expect(message).toContain("New permissions:");
    expect(message).toContain("network:api.example.com");
    expect(message).not.toContain("workspace:read");
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("install_plugin_package", expect.anything());
  });

  it("keeps the recorded grant when the installed plugin merely fails to load", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = {
      get: vi.fn(() => Promise.resolve(null)),
      set: vi.fn((_key: string, _value: unknown) => Promise.resolve()),
    };
    vi.mocked(load).mockResolvedValue(store as never);
    const entry = {
      id: "com.x.market",
      name: "Market",
      version: "1.0.0",
      apiVersion: `^${PLUGIN_API_VERSION}`,
      packageUrl: "https://example.test/plugin.zip",
      sha256: "4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(new Uint8Array([1]).buffer),
      }),
    );
    // Sandboxed like the consent said, but jsdom has no Worker, so the load
    // itself fails after a successful install: the grant must survive.
    vi.mocked(invoke).mockImplementation((cmd) => {
      if (cmd === "list_plugins") return Promise.resolve([]);
      if (cmd === "install_plugin_package")
        return Promise.resolve(installedPlugin({ id: entry.id, name: entry.name, sandbox: true }));
      return Promise.resolve(undefined);
    });

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

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Plugin error:"));
    const grantWrites = store.set.mock.calls.filter(([key]) => key === "grants");
    expect(grantWrites.at(-1)?.[1]).toHaveProperty("com.x.market");
    vi.unstubAllGlobals();
    spy.mockRestore();
  });

  it("declining an update's expanded consent uninstalls cleanly and revokes the grant", async () => {
    // v1 (full trust, granted) is installed and running; the update's package
    // declares yet another permission, so the post-install check re-prompts.
    const store = {
      get: vi.fn((key: string) =>
        Promise.resolve(
          key === "grants"
            ? { "com.x.demo": { permissions: ["workspace:read"], fullTrust: true } }
            : null,
        ),
      ),
      set: vi.fn((_key: string, _value: unknown) => Promise.resolve()),
    };
    vi.mocked(load).mockResolvedValue(store as never);
    const entry = {
      id: "com.x.demo",
      name: "Demo",
      version: "2.0.0",
      apiVersion: `^${PLUGIN_API_VERSION}`,
      sandbox: false,
      permissions: ["workspace:read", "network:a.example"],
      packageUrl: "https://example.test/plugin.zip",
      sha256: "4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a",
    };
    // URL-aware: the mount-time registry fetch needs json, the package
    // download needs arrayBuffer.
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation((url: string) =>
          Promise.resolve(
            url === entry.packageUrl
              ? { ok: true, arrayBuffer: () => Promise.resolve(new Uint8Array([1]).buffer) }
              : { ok: true, json: () => Promise.resolve({ plugins: [] }) },
          ),
        ),
    );
    vi.mocked(invoke).mockImplementation((cmd) => {
      if (cmd === "list_plugins")
        return Promise.resolve([installedPlugin({ permissions: ["workspace:read"] })]);
      if (cmd === "install_plugin_package")
        return Promise.resolve(
          installedPlugin({
            version: "2.0.0",
            permissions: ["workspace:read", "network:a.example", "network:b.example"],
          }),
        );
      return Promise.resolve(undefined);
    });
    vi.mocked(ask).mockClear();
    vi.mocked(ask).mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    function ManageProbe() {
      const p = usePluginsOptional();
      if (!p) return null;
      return (
        <div>
          <span data-testid="installed">{p.installed.map((x) => x.id).join(",")}</span>
          <span data-testid="loaded">{p.loaded.map((x) => x.id).join(",")}</span>
          <button type="button" onClick={() => void p.installFromRegistry(entry)}>
            update
          </button>
        </div>
      );
    }

    render(
      <PluginsProvider>
        <ManageProbe />
      </PluginsProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("com.x.demo"));

    screen.getByRole("button", { name: "update" }).click();

    await waitFor(() =>
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("uninstall_plugin", { id: "com.x.demo" }),
    );
    // Full cleanup, not a bare disk delete: state, host, and grant all clear.
    await waitFor(() => expect(screen.getByTestId("installed").textContent).toBe(""));
    expect(screen.getByTestId("loaded").textContent).toBe("");
    const grantWrites = store.set.mock.calls.filter(([key]) => key === "grants");
    expect(grantWrites.at(-1)?.[1]).toEqual({});
    vi.unstubAllGlobals();
  });

  it("retires a full-trust grant when the plugin returns to the sandbox", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = {
      get: vi.fn((key: string) =>
        Promise.resolve(
          key === "grants"
            ? { "com.x.demo": { permissions: ["workspace:read"], fullTrust: true } }
            : null,
        ),
      ),
      set: vi.fn((_key: string, _value: unknown) => Promise.resolve()),
    };
    vi.mocked(load).mockResolvedValue(store as never);
    // Now sandboxed: the covered grant means no prompt, but the stale
    // fullTrust flag must not survive to silently allow a later flip back.
    vi.mocked(invoke).mockImplementation((cmd) =>
      Promise.resolve(
        cmd === "list_plugins"
          ? [installedPlugin({ sandbox: true, permissions: ["workspace:read"] })]
          : undefined,
      ),
    );
    vi.mocked(ask).mockClear();

    function ManageProbe() {
      const p = usePluginsOptional();
      if (!p) return null;
      return (
        <div>
          <span data-testid="installed">{p.installed.map((x) => x.id).join(",")}</span>
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
    await waitFor(() => expect(screen.getByTestId("installed")).toHaveTextContent("com.x.demo"));

    screen.getByRole("button", { name: "on" }).click();

    await waitFor(() => {
      const grantWrites = store.set.mock.calls.filter(([key]) => key === "grants");
      expect(grantWrites.at(-1)?.[1]).toEqual({
        "com.x.demo": { permissions: ["workspace:read"], fullTrust: false },
      });
    });
    expect(vi.mocked(ask)).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("rolls back a marketplace install when the package demands more trust than advertised", async () => {
    // The registry entry claims a sandboxed, permissionless plugin; the
    // downloaded package's manifest opts out of the sandbox.
    const entry = {
      id: "com.x.market",
      name: "Market",
      version: "1.0.0",
      apiVersion: `^${PLUGIN_API_VERSION}`,
      sandbox: true,
      packageUrl: "https://example.test/plugin.zip",
      sha256: "4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a",
    };
    // URL-aware: the mount-time registry fetch needs json, the package
    // download needs arrayBuffer.
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation((url: string) =>
          Promise.resolve(
            url === entry.packageUrl
              ? { ok: true, arrayBuffer: () => Promise.resolve(new Uint8Array([1]).buffer) }
              : { ok: true, json: () => Promise.resolve({ plugins: [] }) },
          ),
        ),
    );
    vi.mocked(invoke).mockImplementation((cmd) => {
      if (cmd === "list_plugins") return Promise.resolve([]);
      if (cmd === "install_plugin_package")
        return Promise.resolve(installedPlugin({ id: entry.id, name: entry.name }));
      return Promise.resolve(undefined);
    });
    vi.mocked(ask).mockClear();
    vi.mocked(ask).mockResolvedValueOnce(true).mockResolvedValueOnce(false);

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

    await waitFor(() =>
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("uninstall_plugin", { id: entry.id }),
    );
    const [message] = vi.mocked(ask).mock.calls.at(-1) ?? [];
    expect(message).toContain("WITHOUT the plugin sandbox");
    expect(screen.getByTestId("loaded").textContent).toBe("");
    vi.unstubAllGlobals();
  });
});
