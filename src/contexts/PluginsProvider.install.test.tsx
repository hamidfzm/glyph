import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { getStore } from "@tauri-apps/plugin-store";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePluginsOptional } from "@/contexts/PluginsContext";
import { PluginsProvider } from "@/contexts/PluginsProvider";
import { pickPluginDir } from "@/lib/pickers";
import { PLUGIN_API_VERSION } from "@/lib/plugins/apiVersion";
import { loadPluginSettings } from "@/lib/plugins/settingsStore";
import { inspection, installedPlugin, Probe, resetPluginsMocks } from "@/test/pluginsHarness";

vi.mock("@/lib/pickers", () => ({
  pickPluginDir: vi.fn(),
}));

// Core plugins follow app settings and have their own suite (useCorePlugins.test).
vi.mock("@/hooks/useCorePlugins", () => ({ useCorePlugins: () => true }));

vi.mock("@/lib/plugins/settingsStore", () => ({
  loadPluginSettings: vi.fn(() => Promise.resolve({})),
  savePluginSettings: vi.fn(() => Promise.resolve()),
}));

beforeEach(resetPluginsMocks);

describe("PluginsProvider installing", () => {
  it("installs a plugin from a picked folder and shows a toast", async () => {
    vi.mocked(invoke).mockImplementation((cmd) => {
      if (cmd === "list_plugins") return Promise.resolve([]);
      if (cmd === "inspect_plugin") return Promise.resolve(inspection());
      if (cmd === "install_plugin")
        return Promise.resolve(installedPlugin({ id: "com.x.new", name: "Fresh" }));
      return Promise.resolve(undefined);
    });
    vi.mocked(pickPluginDir).mockResolvedValue("/somewhere/plugin-folder");

    function InstallProbe() {
      const plugins = usePluginsOptional();
      return (
        <button type="button" onClick={() => void plugins?.installFromFolder()}>
          install
        </button>
      );
    }

    render(
      <PluginsProvider>
        <InstallProbe />
        <Probe />
      </PluginsProvider>,
    );

    screen.getByRole("button", { name: "install" }).click();

    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("com.x.new"));
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("install_plugin");
    expect(screen.getByRole("status")).toHaveTextContent("Installed plugin: Fresh v1.0.0");
  });

  it("does nothing when the folder picker is cancelled", async () => {
    vi.mocked(invoke).mockImplementation((cmd) =>
      Promise.resolve(cmd === "list_plugins" ? [] : undefined),
    );
    vi.mocked(pickPluginDir).mockResolvedValue(null);

    function InstallProbe() {
      const plugins = usePluginsOptional();
      return (
        <button type="button" onClick={() => void plugins?.installFromFolder()}>
          install
        </button>
      );
    }

    render(
      <PluginsProvider>
        <InstallProbe />
      </PluginsProvider>,
    );
    screen.getByRole("button", { name: "install" }).click();

    await waitFor(() => expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("install_plugin"));
  });

  it("aborts a folder install when consent is declined", async () => {
    vi.mocked(invoke).mockImplementation((cmd) => {
      if (cmd === "list_plugins") return Promise.resolve([]);
      if (cmd === "inspect_plugin") return Promise.resolve(inspection());
      return Promise.resolve(undefined);
    });
    vi.mocked(pickPluginDir).mockResolvedValue("/somewhere/plugin-folder");
    vi.mocked(ask).mockResolvedValueOnce(false);

    function InstallProbe() {
      const plugins = usePluginsOptional();
      return (
        <button type="button" onClick={() => void plugins?.installFromFolder()}>
          install
        </button>
      );
    }

    render(
      <PluginsProvider>
        <InstallProbe />
      </PluginsProvider>,
    );
    screen.getByRole("button", { name: "install" }).click();

    await waitFor(() => expect(vi.mocked(ask)).toHaveBeenCalled());
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("install_plugin");
  });

  it("aborts a marketplace install when consent is declined, and lists permissions in the prompt", async () => {
    vi.mocked(invoke).mockImplementation((cmd) =>
      Promise.resolve(cmd === "list_plugins" ? [] : undefined),
    );
    vi.mocked(ask).mockResolvedValueOnce(false);
    const entry = {
      id: "com.x.market",
      name: "Market",
      version: "1.0.0",
      apiVersion: `^${PLUGIN_API_VERSION}`,
      permissions: ["workspace:read"],
      packageUrl: "https://example.test/plugin.zip",
      sha256: "aa",
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

    await waitFor(() => expect(vi.mocked(ask)).toHaveBeenCalled());
    const [message] = vi.mocked(ask).mock.calls.at(-1) ?? [];
    expect(message).toContain("Market");
    expect(message).toContain("workspace:read");
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("install_plugin_package", expect.anything());
  });

  it("rolls back a folder install when the installed manifest demands more trust than inspected", async () => {
    // What lands on disk claims full trust even though the inspected (and
    // consented) manifest was sandboxed, e.g. the pending pick changed
    // between inspect_plugin and install_plugin.
    vi.mocked(invoke).mockImplementation((cmd) => {
      if (cmd === "list_plugins") return Promise.resolve([]);
      if (cmd === "inspect_plugin") return Promise.resolve(inspection({ sandbox: true }));
      if (cmd === "install_plugin")
        return Promise.resolve(installedPlugin({ id: "com.x.new", name: "Fresh" }));
      return Promise.resolve(undefined);
    });
    vi.mocked(pickPluginDir).mockResolvedValue("/somewhere/plugin-folder");
    vi.mocked(ask).mockClear();
    vi.mocked(ask).mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    function InstallProbe() {
      const plugins = usePluginsOptional();
      return (
        <button type="button" onClick={() => void plugins?.installFromFolder()}>
          install
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
    screen.getByRole("button", { name: "install" }).click();

    await waitFor(() =>
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("uninstall_plugin", { id: "com.x.new" }),
    );
    expect(screen.getByTestId("loaded").textContent).toBe("");
  });

  it("rolls the persisted grant back when the install fails after consent", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = {
      get: vi.fn(() => Promise.resolve(null)),
      set: vi.fn((_key: string, _value: unknown) => Promise.resolve()),
    };
    vi.mocked(getStore).mockResolvedValue(store as never);
    vi.mocked(invoke).mockImplementation((cmd) => {
      if (cmd === "list_plugins") return Promise.resolve([]);
      if (cmd === "inspect_plugin") return Promise.resolve(inspection());
      if (cmd === "install_plugin") return Promise.reject(new Error("disk full"));
      return Promise.resolve(undefined);
    });
    vi.mocked(pickPluginDir).mockResolvedValue("/somewhere/plugin-folder");

    function InstallProbe() {
      const plugins = usePluginsOptional();
      return (
        <button type="button" onClick={() => void plugins?.installFromFolder()}>
          install
        </button>
      );
    }

    render(
      <PluginsProvider>
        <InstallProbe />
      </PluginsProvider>,
    );
    screen.getByRole("button", { name: "install" }).click();

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("disk full"));
    // The consent accept wrote a grant; the failed install removed it again.
    const grantWrites = store.set.mock.calls.filter(([key]) => key === "grants");
    expect(grantWrites.at(-1)?.[1]).toEqual({});
    spy.mockRestore();
  });

  it("reports an inspect failure without touching grants", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = {
      get: vi.fn(() => Promise.resolve(null)),
      set: vi.fn((_key: string, _value: unknown) => Promise.resolve()),
    };
    vi.mocked(getStore).mockResolvedValue(store as never);
    vi.mocked(invoke).mockImplementation((cmd) => {
      if (cmd === "list_plugins") return Promise.resolve([]);
      if (cmd === "inspect_plugin") return Promise.reject(new Error("no plugin folder was picked"));
      return Promise.resolve(undefined);
    });
    vi.mocked(pickPluginDir).mockResolvedValue("/somewhere/plugin-folder");

    function InstallProbe() {
      const plugins = usePluginsOptional();
      return (
        <button type="button" onClick={() => void plugins?.installFromFolder()}>
          install
        </button>
      );
    }

    render(
      <PluginsProvider>
        <InstallProbe />
      </PluginsProvider>,
    );
    screen.getByRole("button", { name: "install" }).click();

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("no plugin folder was picked"),
    );
    // The failure happened before any consent, so there is nothing to restore.
    expect(store.set).not.toHaveBeenCalledWith("grants", expect.anything());
    spy.mockRestore();
  });

  it("surfaces the registry, installs from it, and expires the toast", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const entry = {
      id: "com.x.market",
      name: "Market",
      version: "1.0.0",
      apiVersion: `^${PLUGIN_API_VERSION}`,
      packageUrl: "https://example.test/plugin.zip",
      // SHA-256 of the one-byte package the fetch stub serves.
      sha256: "4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a",
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation((url: string) =>
          Promise.resolve(
            url === "https://example.test/plugin.zip"
              ? { ok: true, arrayBuffer: () => Promise.resolve(new Uint8Array([1]).buffer) }
              : { ok: true, json: () => Promise.resolve({ plugins: [entry] }) },
          ),
        ),
    );
    vi.mocked(invoke).mockImplementation((cmd) => {
      if (cmd === "list_plugins") return Promise.resolve([]);
      if (cmd === "install_plugin_package")
        return Promise.resolve(installedPlugin({ id: entry.id, name: entry.name }));
      return Promise.resolve(undefined);
    });

    function MarketProbe() {
      const p = usePluginsOptional();
      if (!p) return null;
      return (
        <div>
          <span data-testid="registry">{p.registry.map((e) => e.id).join(",")}</span>
          <span data-testid="loaded">{p.loaded.map((x) => x.id).join(",")}</span>
          <button
            type="button"
            onClick={() => p.registry[0] && void p.installFromRegistry(p.registry[0])}
          >
            market
          </button>
        </div>
      );
    }

    render(
      <PluginsProvider>
        <MarketProbe />
      </PluginsProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("registry")).toHaveTextContent("com.x.market"));
    screen.getByRole("button", { name: "market" }).click();

    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("com.x.market"));
    expect(screen.getByRole("status")).toHaveTextContent("Installed plugin: Market v1.0.0");

    // The toast auto-expires; the timer callback sets state, so it runs in act.
    act(() => {
      vi.advanceTimersByTime(4100);
    });
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());

    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("shows an error toast when install fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke).mockImplementation((cmd) => {
      if (cmd === "list_plugins") return Promise.resolve([]);
      if (cmd === "inspect_plugin") return Promise.resolve(inspection());
      if (cmd === "install_plugin") return Promise.reject(new Error("not a plugin folder"));
      return Promise.resolve(undefined);
    });
    vi.mocked(pickPluginDir).mockResolvedValue("/bad/folder");

    function InstallProbe() {
      const plugins = usePluginsOptional();
      return (
        <button type="button" onClick={() => void plugins?.installFromFolder()}>
          install
        </button>
      );
    }

    render(
      <PluginsProvider>
        <InstallProbe />
      </PluginsProvider>,
    );
    screen.getByRole("button", { name: "install" }).click();

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Plugin error: not a plugin folder"),
    );
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("stringifies non-Error failures in the error toast", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke).mockImplementation((cmd) => {
      if (cmd === "list_plugins") return Promise.resolve([]);
      if (cmd === "inspect_plugin") return Promise.resolve(inspection());
      // Tauri commands reject with plain strings, not Error objects.
      if (cmd === "install_plugin") return Promise.reject("not a plugin folder");
      return Promise.resolve(undefined);
    });
    vi.mocked(pickPluginDir).mockResolvedValue("/bad/folder");

    function InstallProbe() {
      const plugins = usePluginsOptional();
      return (
        <button type="button" onClick={() => void plugins?.installFromFolder()}>
          install
        </button>
      );
    }

    render(
      <PluginsProvider>
        <InstallProbe />
      </PluginsProvider>,
    );
    screen.getByRole("button", { name: "install" }).click();

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Plugin error: not a plugin folder"),
    );
    spy.mockRestore();
  });
});

// Activation takes a while, which is the window the uninstall lands in.
const slowSource = `export default {
  async activate(ctx) {
    await new Promise((resolve) => setTimeout(resolve, 30));
    ctx.commands.register({ id: "slow.cmd", title: "Slow", run() {} });
  },
};`;

function SupersedeProbe({ install }: { install: "folder" | "registry" }) {
  const p = usePluginsOptional();
  if (!p) return null;
  return (
    <div>
      <span data-testid="installed">{p.installed.map((x) => x.id).join(",")}</span>
      <button
        type="button"
        onClick={() =>
          void (install === "folder" ? p.installFromFolder() : p.installFromRegistry(p.registry[0]))
        }
      >
        install
      </button>
      <button type="button" onClick={() => void p.uninstall("com.x.slow")}>
        uninstall
      </button>
    </div>
  );
}

describe("PluginsProvider installs overtaken by an uninstall", () => {
  it.each(["folder", "registry"] as const)(
    "a %s install whose load an uninstall overtook leaves the plugin gone",
    async (install) => {
      const slow = installedPlugin({ id: "com.x.slow", name: "Slow", mainSource: slowSource });
      const entry = {
        id: "com.x.slow",
        name: "Slow",
        version: "1.0.0",
        apiVersion: `^${PLUGIN_API_VERSION}`,
        packageUrl: "https://example.test/plugin.zip",
        // SHA-256 of the one-byte package the fetch stub serves.
        sha256: "4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a",
      };
      vi.stubGlobal(
        "fetch",
        vi.fn((url: string) =>
          Promise.resolve(
            url === entry.packageUrl
              ? { ok: true, arrayBuffer: () => Promise.resolve(new Uint8Array([1]).buffer) }
              : { ok: true, json: () => Promise.resolve({ plugins: [entry] }) },
          ),
        ),
      );
      vi.mocked(invoke).mockImplementation((cmd) => {
        if (cmd === "list_plugins") return Promise.resolve([]);
        if (cmd === "inspect_plugin") return Promise.resolve(inspection({ id: "com.x.slow" }));
        if (cmd === "install_plugin" || cmd === "install_plugin_package") {
          return Promise.resolve(slow);
        }
        return Promise.resolve(undefined);
      });
      vi.mocked(pickPluginDir).mockResolvedValue("/somewhere/plugin-folder");

      render(
        <PluginsProvider>
          <SupersedeProbe install={install} />
          <Probe />
        </PluginsProvider>,
      );
      await waitFor(() => expect(screen.getByTestId("initial-load")).toHaveTextContent("true"));

      await act(async () => {
        screen.getByRole("button", { name: "install" }).click();
      });
      // The host reads the plugin's settings as it starts loading it.
      await waitFor(() => expect(loadPluginSettings).toHaveBeenCalledWith("com.x.slow"));
      await act(async () => {
        screen.getByRole("button", { name: "uninstall" }).click();
      });
      await act(() => new Promise((resolve) => setTimeout(resolve, 60)));

      expect(screen.getByTestId("installed").textContent).toBe("");
      expect(screen.getByTestId("loaded").textContent).toBe("");
      expect(screen.queryByText(/Installed plugin/)).not.toBeInTheDocument();
    },
  );
});

it("an update that a disable overtook shows the new version, still disabled", async () => {
  const v2 = installedPlugin({ version: "2.0.0", mainSource: slowSource });
  const entry = {
    id: "com.x.demo",
    name: "Demo",
    version: "2.0.0",
    apiVersion: `^${PLUGIN_API_VERSION}`,
    packageUrl: "https://example.test/plugin.zip",
    // SHA-256 of the one-byte package the fetch stub serves.
    sha256: "4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve(
        url === entry.packageUrl
          ? { ok: true, arrayBuffer: () => Promise.resolve(new Uint8Array([1]).buffer) }
          : { ok: true, json: () => Promise.resolve({ plugins: [entry] }) },
      ),
    ),
  );
  vi.mocked(invoke).mockImplementation((cmd) => {
    if (cmd === "list_plugins") return Promise.resolve([installedPlugin()]);
    if (cmd === "install_plugin_package") return Promise.resolve(v2);
    return Promise.resolve(undefined);
  });

  function UpdateProbe() {
    const p = usePluginsOptional();
    if (!p) return null;
    return (
      <div>
        <span data-testid="versions">{p.installed.map((x) => x.version).join(",")}</span>
        <span data-testid="disabled">{p.disabled.join(",")}</span>
        <button type="button" onClick={() => void p.installFromRegistry(p.updates[0].entry)}>
          update
        </button>
        <button type="button" onClick={() => void p.setEnabled("com.x.demo", false)}>
          off
        </button>
      </div>
    );
  }

  render(
    <PluginsProvider>
      <UpdateProbe />
      <Probe />
    </PluginsProvider>,
  );
  await waitFor(() => expect(screen.getByRole("button", { name: "update" })).toBeInTheDocument());
  await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("com.x.demo"));
  const settingsLoadsBefore = vi.mocked(loadPluginSettings).mock.calls.length;

  await act(async () => {
    screen.getByRole("button", { name: "update" }).click();
  });
  await waitFor(() =>
    expect(vi.mocked(loadPluginSettings).mock.calls.length).toBeGreaterThan(settingsLoadsBefore),
  );
  await act(async () => {
    screen.getByRole("button", { name: "off" }).click();
  });
  await act(() => new Promise((resolve) => setTimeout(resolve, 60)));

  expect(screen.getByTestId("versions").textContent).toBe("2.0.0");
  expect(screen.getByTestId("disabled")).toHaveTextContent("com.x.demo");
  expect(screen.getByTestId("loaded").textContent).toBe("");
});
