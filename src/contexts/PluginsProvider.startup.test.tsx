import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePluginsOptional } from "@/contexts/PluginsContext";
import { PluginsProvider } from "@/contexts/PluginsProvider";
import { pickPluginDir } from "@/lib/pickers";
import { loadPluginSettings, savePluginSettings } from "@/lib/plugins/settingsStore";
import {
  grantedStore,
  inspection,
  installedPlugin,
  Probe,
  resetPluginsMocks,
} from "@/test/pluginsHarness";

vi.mock("@/lib/pickers", () => ({
  pickPluginDir: vi.fn(),
}));

vi.mock("@/lib/plugins/settingsStore", () => ({
  loadPluginSettings: vi.fn(() => Promise.resolve({})),
  savePluginSettings: vi.fn(() => Promise.resolve()),
}));

beforeEach(resetPluginsMocks);

describe("PluginsProvider startup", () => {
  it("flips initialLoadDone once the startup scan and load pass finishes", async () => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(undefined);
    render(
      <PluginsProvider>
        <Probe />
      </PluginsProvider>,
    );
    // Renders false first, then true after the async startup pass, even with
    // nothing installed: the CLI website export gates on this.
    await waitFor(() => expect(screen.getByTestId("initial-load")).toHaveTextContent("true"));
  });

  beforeEach(() => {
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
  });

  it("hydrates and persists plugin settings through the store", async () => {
    vi.mocked(loadPluginSettings).mockResolvedValueOnce({ size: 12 });
    const plugin = installedPlugin({
      mainSource: `export default {
        activate(ctx) {
          const size = ctx.settings.get("size");
          ctx.settings.set("size", size + 1);
        },
      };`,
    });
    vi.mocked(invoke).mockImplementation((cmd) =>
      Promise.resolve(cmd === "list_plugins" ? [plugin] : undefined),
    );

    render(
      <PluginsProvider>
        <Probe />
      </PluginsProvider>,
    );

    await waitFor(() =>
      expect(vi.mocked(savePluginSettings)).toHaveBeenCalledWith("com.x.demo", { size: 13 }),
    );
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

  it("abandons the startup pass when unmounted while a plugin is still loading", async () => {
    // First scenario: unmount during the only plugin's load; the pass must
    // finish without committing state. Second: unmount with a second plugin
    // still queued; the loop must stop before touching it.
    for (const plugins of [
      [installedPlugin()],
      [installedPlugin(), installedPlugin({ id: "com.x.second", name: "Second" })],
    ]) {
      let releaseSettings!: (v: Record<string, unknown>) => void;
      vi.mocked(loadPluginSettings).mockClear();
      vi.mocked(loadPluginSettings).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseSettings = resolve;
          }),
      );
      let releaseFetch!: () => void;
      vi.stubGlobal(
        "fetch",
        vi.fn(
          () =>
            new Promise((resolve) => {
              releaseFetch = () =>
                resolve({ ok: true, json: () => Promise.resolve({ plugins: [] }) });
            }),
        ),
      );
      vi.mocked(invoke).mockImplementation((cmd) =>
        Promise.resolve(cmd === "list_plugins" ? plugins : undefined),
      );

      const { unmount } = render(
        <PluginsProvider>
          <Probe />
        </PluginsProvider>,
      );
      await waitFor(() => expect(vi.mocked(loadPluginSettings)).toHaveBeenCalled());
      unmount();
      releaseSettings({});
      releaseFetch();
      await new Promise((resolve) => setTimeout(resolve, 0));
      // The cancel gate stops the loop: the queued second plugin (when
      // present) must never start loading its settings after unmount.
      expect(vi.mocked(loadPluginSettings)).toHaveBeenCalledTimes(1);
      vi.mocked(loadPluginSettings).mockClear();
      vi.unstubAllGlobals();
    }
  });

  it("skips disabled plugins at startup and re-enables one on reinstall", async () => {
    // Once: only the startup loadDisabled sees the pre-disabled store; later
    // calls (saveDisabled, other tests) fall through to the setup default.
    vi.mocked(load).mockResolvedValueOnce({
      get: vi.fn().mockResolvedValue(["com.x.demo"]),
      set: vi.fn(),
    } as never);
    vi.mocked(invoke).mockImplementation((cmd) => {
      if (cmd === "list_plugins") return Promise.resolve([installedPlugin()]);
      if (cmd === "inspect_plugin")
        return Promise.resolve(inspection({ id: "com.x.demo", name: "Demo" }));
      if (cmd === "install_plugin") return Promise.resolve(installedPlugin());
      return Promise.resolve(undefined);
    });
    vi.mocked(pickPluginDir).mockResolvedValue("/somewhere/plugin-folder");

    function ManageProbe() {
      const p = usePluginsOptional();
      if (!p) return null;
      return (
        <div>
          <span data-testid="loaded">{p.loaded.map((x) => x.id).join(",")}</span>
          <span data-testid="disabled">{p.disabled.join(",")}</span>
          <button type="button" onClick={() => void p.installFromFolder()}>
            install
          </button>
        </div>
      );
    }

    render(
      <PluginsProvider>
        <ManageProbe />
      </PluginsProvider>,
    );

    // Disabled at startup: on disk, not loaded.
    await waitFor(() => expect(screen.getByTestId("disabled")).toHaveTextContent("com.x.demo"));
    expect(screen.getByTestId("loaded").textContent).toBe("");

    // Reinstalling implies consent + enable: the disabled marker clears.
    screen.getByRole("button", { name: "install" }).click();
    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("com.x.demo"));
    expect(screen.getByTestId("disabled").textContent).toBe("");
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
