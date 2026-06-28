import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRegistryEntries } from "@/hooks/usePluginRegistry";
import type { InstalledPlugin } from "@/lib/plugins/types";
import { usePluginsOptional } from "./PluginsContext";
import { PluginsProvider } from "./PluginsProvider";

function installedPlugin(overrides: Partial<InstalledPlugin> = {}): InstalledPlugin {
  return {
    id: "com.x.demo",
    name: "Demo",
    version: "1.0.0",
    apiVersion: "^1.0.0",
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

/** Probe that surfaces the provider state for assertions. */
function Probe() {
  const plugins = usePluginsOptional();
  const commands = useRegistryEntries(plugins?.commands ?? null);
  return (
    <div>
      <span data-testid="loaded">{plugins?.loaded.map((p) => p.id).join(",")}</span>
      <span data-testid="commands">{commands.map((c) => c.id).join(",")}</span>
    </div>
  );
}

describe("PluginsProvider", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  it("loads installed plugins on mount and exposes their contributions", async () => {
    vi.mocked(invoke).mockImplementation((cmd) =>
      Promise.resolve(cmd === "list_plugins" ? [installedPlugin()] : undefined),
    );

    render(
      <PluginsProvider>
        <Probe />
      </PluginsProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("com.x.demo"));
    expect(screen.getByTestId("commands")).toHaveTextContent("demo.hi");
  });

  it("survives a broken plugin and still reports the rest", async () => {
    const broken = installedPlugin({ id: "com.x.broken", mainSource: "export default {" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke).mockImplementation((cmd) =>
      Promise.resolve(cmd === "list_plugins" ? [broken, installedPlugin()] : undefined),
    );

    render(
      <PluginsProvider>
        <Probe />
      </PluginsProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("com.x.demo"));
    expect(screen.getByTestId("loaded")).not.toHaveTextContent("com.x.broken");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("installs a plugin from a picked folder and shows a toast", async () => {
    vi.mocked(invoke).mockImplementation((cmd) => {
      if (cmd === "list_plugins") return Promise.resolve([]);
      if (cmd === "install_plugin")
        return Promise.resolve(installedPlugin({ id: "com.x.new", name: "Fresh" }));
      return Promise.resolve(undefined);
    });
    vi.mocked(open).mockResolvedValue("/somewhere/plugin-folder");

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
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("install_plugin", {
      srcDir: "/somewhere/plugin-folder",
    });
    expect(screen.getByRole("status")).toHaveTextContent("Installed plugin: Fresh v1.0.0");
  });

  it("does nothing when the folder picker is cancelled", async () => {
    vi.mocked(invoke).mockImplementation((cmd) =>
      Promise.resolve(cmd === "list_plugins" ? [] : undefined),
    );
    vi.mocked(open).mockResolvedValue(null);

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
      expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("install_plugin", expect.anything()),
    );
  });

  it("shows an error toast when install fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke).mockImplementation((cmd) => {
      if (cmd === "list_plugins") return Promise.resolve([]);
      if (cmd === "install_plugin") return Promise.reject(new Error("not a plugin folder"));
      return Promise.resolve(undefined);
    });
    vi.mocked(open).mockResolvedValue("/bad/folder");

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

    screen.getByRole("button", { name: "off" }).click();
    await waitFor(() => expect(screen.getByTestId("disabled")).toHaveTextContent("com.x.demo"));
    expect(screen.getByTestId("loaded")).toHaveTextContent("");
    expect(screen.getByTestId("commands")).toHaveTextContent("0");

    screen.getByRole("button", { name: "on" }).click();
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

  it("logs and stays empty when listing installed plugins fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke).mockImplementation((cmd) =>
      cmd === "list_plugins" ? Promise.reject(new Error("io error")) : Promise.resolve(undefined),
    );

    render(
      <PluginsProvider>
        <Probe />
      </PluginsProvider>,
    );

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(screen.getByTestId("loaded")).toHaveTextContent("");
    spy.mockRestore();
  });
});
