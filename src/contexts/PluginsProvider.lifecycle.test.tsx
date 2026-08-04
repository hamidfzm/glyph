import { invoke } from "@tauri-apps/api/core";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePluginsOptional } from "@/contexts/PluginsContext";
import { PluginsProvider } from "@/contexts/PluginsProvider";
import { useRegistryEntries } from "@/hooks/usePluginRegistry";
import { PLUGIN_API_VERSION } from "@/lib/plugins/apiVersion";
import { installedPlugin, resetPluginsMocks } from "@/test/pluginsHarness";

vi.mock("@/lib/pickers", () => ({
  pickPluginDir: vi.fn(),
}));

vi.mock("@/lib/plugins/settingsStore", () => ({
  loadPluginSettings: vi.fn(() => Promise.resolve({})),
  savePluginSettings: vi.fn(() => Promise.resolve()),
}));

beforeEach(resetPluginsMocks);

describe("PluginsProvider enable and uninstall", () => {
  it("tolerates enable and disable edge states across repeat calls", async () => {
    vi.mocked(invoke).mockImplementation((cmd) =>
      Promise.resolve(cmd === "list_plugins" ? [installedPlugin()] : undefined),
    );

    function ManageProbe() {
      const p = usePluginsOptional();
      if (!p) return null;
      return (
        <div>
          <span data-testid="installed">{p.installed.map((x) => x.id).join(",")}</span>
          <span data-testid="loaded">{p.loaded.map((x) => x.id).join(",")}</span>
          <span data-testid="disabled">{p.disabled.join(",")}</span>
          <button type="button" onClick={() => void p.setEnabled("com.x.absent", true)}>
            on-absent
          </button>
          <button type="button" onClick={() => void p.setEnabled("com.x.demo", true)}>
            on
          </button>
          <button type="button" onClick={() => void p.setEnabled("com.x.demo", false)}>
            off
          </button>
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
    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("com.x.demo"));

    // These handlers set state synchronously (unload path) or in a microtask
    // tail the following waitFor can miss, so each click settles inside act.
    // Enabling an id that is not installed is a no-op.
    await act(async () => {
      screen.getByRole("button", { name: "on-absent" }).click();
    });
    // Enabling an already-enabled plugin stays enabled and never marks it disabled.
    await act(async () => {
      screen.getByRole("button", { name: "on" }).click();
    });
    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("com.x.demo"));
    expect(screen.getByTestId("disabled").textContent).toBe("");

    // Disabling twice keeps a single disabled entry.
    await act(async () => {
      screen.getByRole("button", { name: "off" }).click();
    });
    await waitFor(() => expect(screen.getByTestId("disabled")).toHaveTextContent("com.x.demo"));
    await act(async () => {
      screen.getByRole("button", { name: "off" }).click();
    });
    await waitFor(() => expect(screen.getByTestId("disabled").textContent).toBe("com.x.demo"));

    // Uninstalling a disabled plugin clears both lists.
    await act(async () => {
      screen.getByRole("button", { name: "rm" }).click();
    });
    await waitFor(() => expect(screen.getByTestId("installed").textContent).toBe(""));
    expect(screen.getByTestId("disabled").textContent).toBe("");
  });

  it("routes ctx.workspace reads through the synced workspace root", async () => {
    const reader = installedPlugin({
      permissions: ["workspace:read"],
      mainSource: `export default {
        activate(ctx) {
          ctx.commands.register({
            id: "demo.read",
            title: "Read",
            async run() { await ctx.workspace.readFile("sub/a.md"); },
          });
        },
      };`,
    });
    vi.mocked(invoke).mockImplementation((cmd) =>
      Promise.resolve(cmd === "list_plugins" ? [reader] : undefined),
    );

    function WorkspaceProbe() {
      const p = usePluginsOptional();
      const commands = useRegistryEntries(p?.commands ?? null);
      return (
        <div>
          <button type="button" onClick={() => p?.setWorkspaceRoot("/ws")}>
            setroot
          </button>
          <button type="button" onClick={() => void commands[0]?.run()}>
            read
          </button>
          <span data-testid="ready">{commands.length}</span>
        </div>
      );
    }

    render(
      <PluginsProvider>
        <WorkspaceProbe />
      </PluginsProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("ready")).toHaveTextContent("1"));

    screen.getByRole("button", { name: "setroot" }).click();
    screen.getByRole("button", { name: "read" }).click();

    await waitFor(() =>
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("read_file", { path: "/ws/sub/a.md" }),
    );
  });

  it("shows an error toast when a marketplace download fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke).mockImplementation((cmd) =>
      Promise.resolve(cmd === "list_plugins" ? [] : undefined),
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const entry = {
      id: "com.x.market",
      name: "Market",
      version: "1.0.0",
      apiVersion: `^${PLUGIN_API_VERSION}`,
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
      </PluginsProvider>,
    );
    screen.getByRole("button", { name: "market" }).click();

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Plugin error: download failed: 500"),
    );
    vi.unstubAllGlobals();
    spy.mockRestore();
  });

  it("keeps a plugin disabled and reports the error when re-enabling fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = installedPlugin({ mainSource: "export default {" });
    vi.mocked(invoke).mockImplementation((cmd) =>
      Promise.resolve(cmd === "list_plugins" ? [broken] : undefined),
    );

    function ManageProbe() {
      const p = usePluginsOptional();
      if (!p) return null;
      return (
        <div>
          <span data-testid="installed">{p.installed.map((x) => x.id).join(",")}</span>
          <span data-testid="loaded">{p.loaded.map((x) => x.id).join(",")}</span>
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

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Plugin error:"));
    expect(screen.getByTestId("loaded").textContent).toBe("");
    spy.mockRestore();
  });

  it("keeps the plugin installed and reports the error when uninstall fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke).mockImplementation((cmd) => {
      if (cmd === "list_plugins") return Promise.resolve([installedPlugin()]);
      if (cmd === "uninstall_plugin") return Promise.reject(new Error("locked file"));
      return Promise.resolve(undefined);
    });

    function ManageProbe() {
      const p = usePluginsOptional();
      if (!p) return null;
      return (
        <div>
          <span data-testid="installed">{p.installed.map((x) => x.id).join(",")}</span>
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

    screen.getByRole("button", { name: "rm" }).click();

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Plugin error: locked file"),
    );
    expect(screen.getByTestId("installed")).toHaveTextContent("com.x.demo");
    spy.mockRestore();
  });

  it("deactivates and reactivates a plugin", async () => {
    vi.mocked(invoke).mockImplementation((cmd) =>
      Promise.resolve(cmd === "list_plugins" ? [installedPlugin()] : undefined),
    );

    function ManageProbe() {
      const p = usePluginsOptional();
      if (!p) return null;
      return (
        <div>
          <span data-testid="loaded">{p.loaded.map((x) => x.id).join(",")}</span>
          <span data-testid="disabled">{p.disabled.join(",")}</span>
          <span data-testid="commands">{p.commands.list().length}</span>
          <button type="button" onClick={() => void p.setEnabled("com.x.demo", false)}>
            off
          </button>
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

    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("com.x.demo"));

    // The disable handler sets state synchronously and the enable handler in a
    // microtask tail the waitFor can miss, so each click settles inside act.
    await act(async () => {
      screen.getByRole("button", { name: "off" }).click();
    });
    await waitFor(() => expect(screen.getByTestId("disabled")).toHaveTextContent("com.x.demo"));
    expect(screen.getByTestId("loaded")).toHaveTextContent("");
    expect(screen.getByTestId("commands")).toHaveTextContent("0");

    await act(async () => {
      screen.getByRole("button", { name: "on" }).click();
    });
    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("com.x.demo"));
    expect(screen.getByTestId("disabled").textContent).toBe("");
  });

  it("uninstalls a plugin", async () => {
    vi.mocked(invoke).mockImplementation((cmd) =>
      Promise.resolve(cmd === "list_plugins" ? [installedPlugin()] : undefined),
    );

    function ManageProbe() {
      const p = usePluginsOptional();
      if (!p) return null;
      return (
        <div>
          <span data-testid="installed">{p.installed.map((x) => x.id).join(",")}</span>
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
    screen.getByRole("button", { name: "rm" }).click();

    await waitFor(() => expect(screen.getByTestId("installed").textContent).toBe(""));
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("uninstall_plugin", { id: "com.x.demo" });
  });
});
