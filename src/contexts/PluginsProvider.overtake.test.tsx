import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { getStore } from "@tauri-apps/plugin-store";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type PluginsContextValue, usePluginsOptional } from "@/contexts/PluginsContext";
import { PluginsProvider } from "@/contexts/PluginsProvider";
import { pickPluginDir } from "@/lib/pickers";
import { PLUGIN_API_VERSION } from "@/lib/plugins/apiVersion";
import type { RegistryEntry } from "@/lib/plugins/marketplace";
import { loadPluginSettings } from "@/lib/plugins/settingsStore";
import type { InstalledPlugin } from "@/lib/plugins/types";
import { expectConsole } from "@/test/consoleGuard";
import { deferred } from "@/test/deferred";
import {
  grantedStore,
  inspection,
  installedPlugin,
  Probe,
  resetPluginsMocks,
} from "@/test/pluginsHarness";

// An install takes a while (a download, a copy, a consent prompt, the plugin's
// own activation), and Remove and the enable checkbox are a click away the
// whole time. Whatever the user does to the plugin meanwhile has to stand.
// Every case holds the install at one point on a gate the test opens, so the
// order of events is the same on every run.

vi.mock("@/lib/pickers", () => ({
  pickPluginDir: vi.fn(),
}));

// Core plugins follow app settings and have their own suite (useCorePlugins.test).
vi.mock("@/hooks/useCorePlugins", () => ({ useCorePlugins: () => true }));

vi.mock("@/lib/plugins/settingsStore", () => ({
  loadPluginSettings: vi.fn(() => Promise.resolve({})),
  savePluginSettings: vi.fn(() => Promise.resolve()),
}));

beforeEach(() => {
  resetPluginsMocks();
  vi.mocked(pickPluginDir).mockResolvedValue("/somewhere/plugin-folder");
});

const gatedSource = `export default {
  async activate() {
    await globalThis.__glyphActivateGate;
  },
};`;

/** Arms the gate `gatedSource` waits on in activate, and returns what opens it. */
function gateActivation() {
  const gate = deferred();
  (globalThis as { __glyphActivateGate?: Promise<void> }).__glyphActivateGate = gate.promise;
  return gate.resolve;
}

// Full trust, like the installedPlugin fixture it is the listing for.
function marketEntry(id: string, name: string, version: string): RegistryEntry {
  return {
    id,
    name,
    version,
    apiVersion: `^${PLUGIN_API_VERSION}`,
    sandbox: false,
    packageUrl: "https://example.test/plugin.zip",
    // SHA-256 of the one-byte package serveMarket serves.
    sha256: "4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a",
  };
}

/** A marketplace listing only `entry`, whose package arrives when `download` does. */
function serveMarket(
  entry: RegistryEntry,
  download: Promise<ArrayBuffer> = Promise.resolve(new Uint8Array([1]).buffer),
) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve(
        url === entry.packageUrl
          ? { ok: true, arrayBuffer: () => download }
          : { ok: true, json: () => Promise.resolve({ plugins: [entry] }) },
      ),
    ),
  );
}

const isInstall = (cmd: string) => cmd === "install_plugin" || cmd === "install_plugin_package";

const installsRequested = () =>
  vi.mocked(invoke).mock.calls.filter(([cmd]) => isInstall(cmd)).length;

interface Backend {
  /** On disk before the test starts. */
  installed?: InstalledPlugin[];
  /** Called for each install, which reaches the disk when the result resolves. */
  landing?: () => Promise<void>;
  /** Asked on each removal: true fails it, the way a file held open does. */
  locked?: () => boolean;
}

/** A backend whose plugins folder the test can read back; installs put `incoming` in it. */
function pluginsFolder(
  incoming: InstalledPlugin,
  { installed = [], landing = () => Promise.resolve(), locked = () => false }: Backend = {},
) {
  const onDisk = new Map(installed.map((plugin) => [plugin.id, plugin]));
  vi.mocked(invoke).mockImplementation((cmd, args) => {
    if (cmd === "list_plugins") return Promise.resolve([...onDisk.values()]);
    if (cmd === "inspect_plugin") return Promise.resolve(inspection({ id: incoming.id }));
    if (isInstall(cmd)) {
      return landing().then(() => {
        onDisk.set(incoming.id, incoming);
        return incoming;
      });
    }
    if (cmd === "uninstall_plugin") {
      if (locked()) return Promise.reject("locked");
      onDisk.delete((args as { id: string }).id);
    }
    return Promise.resolve(undefined);
  });
  return onDisk;
}

type StartInstall = (plugins: PluginsContextValue) => Promise<void>;

function OvertakeProbe({
  id,
  start,
  installs,
}: {
  id: string;
  start: StartInstall;
  installs: Promise<void>[];
}) {
  const p = usePluginsOptional();
  if (!p) return null;
  return (
    <div>
      <span data-testid="installed">
        {p.installed.map((x) => `${x.id}@${x.version}`).join(",")}
      </span>
      <span data-testid="disabled">{p.disabled.join(",")}</span>
      <button
        type="button"
        onClick={() => {
          installs.push(start(p));
        }}
      >
        install
      </button>
      <button type="button" onClick={() => void p.uninstall(id)}>
        uninstall
      </button>
      <button type="button" onClick={() => void p.setEnabled(id, false)}>
        off
      </button>
      <button type="button" onClick={() => void p.setEnabled(id, true)}>
        on
      </button>
    </div>
  );
}

/** Mounts the provider, and returns the promise of each install the test goes on to start. */
async function mountOvertake(id: string, start: StartInstall) {
  const installs: Promise<void>[] = [];
  render(
    <PluginsProvider>
      <OvertakeProbe id={id} start={start} installs={installs} />
      <Probe />
    </PluginsProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("initial-load")).toHaveTextContent("true"));
  return installs;
}

const press = (name: string) =>
  act(async () => {
    screen.getByRole("button", { name }).click();
  });

describe("PluginsProvider installs overtaken by an uninstall", () => {
  const entry = marketEntry("com.x.slow", "Slow", "1.0.0");
  const update = marketEntry("com.x.demo", "Demo", "2.0.0");
  const starts = {
    folder: (p: PluginsContextValue) => p.installFromFolder(),
    registry: (p: PluginsContextValue) => p.installFromRegistry(entry),
  };

  beforeEach(() => serveMarket(entry));

  function expectGone(onDisk: Map<string, InstalledPlugin>) {
    expect(screen.getByTestId("installed").textContent).toBe("");
    expect(screen.getByTestId("loaded").textContent).toBe("");
    expect([...onDisk.keys()]).toEqual([]);
    expect(screen.queryByText(/Installed plugin/)).not.toBeInTheDocument();
  }

  it.each(["folder", "registry"] as const)(
    "a %s install whose load an uninstall overtook leaves the plugin gone",
    async (install) => {
      const openGate = gateActivation();
      const slow = installedPlugin({ id: "com.x.slow", name: "Slow", mainSource: gatedSource });
      const onDisk = pluginsFolder(slow);
      const installs = await mountOvertake(slow.id, starts[install]);

      await press("install");
      // The host reads the plugin's settings as it starts loading it.
      await waitFor(() => expect(loadPluginSettings).toHaveBeenCalledWith("com.x.slow"));
      await press("uninstall");
      await act(async () => {
        openGate();
        await Promise.all(installs);
      });

      expectGone(onDisk);
    },
  );

  // The long window in the app: the package is still downloading or copying.
  it.each(["folder", "registry"] as const)(
    "a %s install that an uninstall overtook before it landed is removed again",
    async (install) => {
      const landing = deferred();
      const slow = installedPlugin({ id: "com.x.slow", name: "Slow" });
      const onDisk = pluginsFolder(slow, { landing: () => landing.promise });
      const installs = await mountOvertake(slow.id, starts[install]);

      await press("install");
      await waitFor(() => expect(installsRequested()).toBe(1));
      await press("uninstall");
      await act(async () => {
        landing.resolve();
        await Promise.all(installs);
      });

      expectGone(onDisk);
    },
  );

  it("an install that an uninstall overtook at the consent prompt is removed again", async () => {
    // The package wants full trust its listing did not mention, so after the
    // usual prompt a second one opens once the plugin is on disk, and stays
    // open until the test answers it.
    const sandboxed = { ...entry, sandbox: true };
    serveMarket(sandboxed);
    const answer = deferred<boolean>();
    vi.mocked(ask).mockClear();
    vi.mocked(ask).mockResolvedValueOnce(true).mockReturnValueOnce(answer.promise);
    const slow = installedPlugin({ id: "com.x.slow", name: "Slow" });
    const onDisk = pluginsFolder(slow);
    const installs = await mountOvertake(slow.id, (p) => p.installFromRegistry(sandboxed));

    await press("install");
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(2));
    await press("uninstall");
    await act(async () => {
      answer.resolve(true);
      await Promise.all(installs);
    });

    expectGone(onDisk);
  });

  it("an update that both a disable and an uninstall overtook is removed again", async () => {
    const landing = deferred();
    serveMarket(update);
    const onDisk = pluginsFolder(installedPlugin({ version: "2.0.0" }), {
      installed: [installedPlugin()],
      landing: () => landing.promise,
    });
    const installs = await mountOvertake("com.x.demo", (p) => p.installFromRegistry(update));

    await press("install");
    await waitFor(() => expect(installsRequested()).toBe(1));
    await press("off");
    await press("uninstall");
    await act(async () => {
      landing.resolve();
      await Promise.all(installs);
    });

    // Nothing is left to keep disabled, so the new version must not stay on disk.
    expectGone(onDisk);
  });

  it("an update that failed after an uninstall overtook it leaves no grant behind", async () => {
    expectConsole(/Plugin operation failed/);
    const store = grantedStore();
    vi.mocked(getStore).mockResolvedValue(store as never);
    const download = deferred<ArrayBuffer>();
    serveMarket(update, download.promise);
    pluginsFolder(installedPlugin({ version: "2.0.0" }), { installed: [installedPlugin()] });
    const installs = await mountOvertake("com.x.demo", (p) => p.installFromRegistry(update));

    await press("install");
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith(update.packageUrl));
    await press("uninstall");
    await act(async () => {
      download.reject(new Error("offline"));
      await Promise.all(installs);
    });

    expect(screen.getByRole("status")).toHaveTextContent("Plugin error: offline");
    // Putting back the grant the update began with would pre-authorize the
    // next plugin installed under this id, with full trust and no warning.
    const grantWrites = store.set.mock.calls.filter(([key]) => key === "grants");
    expect(grantWrites.at(-1)?.[1]).not.toHaveProperty("com.x.demo");
  });

  it("an update lands as usual when the removal that overtook it failed", async () => {
    expectConsole(/Plugin operation failed/);
    const landing = deferred();
    serveMarket(update);
    const onDisk = pluginsFolder(installedPlugin({ version: "2.0.0" }), {
      installed: [installedPlugin()],
      landing: () => landing.promise,
      locked: () => true,
    });
    const installs = await mountOvertake("com.x.demo", (p) => p.installFromRegistry(update));

    await press("install");
    await waitFor(() => expect(installsRequested()).toBe(1));
    await press("uninstall");
    expect(screen.getByText("Plugin error: locked")).toBeInTheDocument();
    await act(async () => {
      landing.resolve();
      await Promise.all(installs);
    });

    expect(screen.getByTestId("installed").textContent).toBe("com.x.demo@2.0.0");
    expect(screen.getByTestId("loaded")).toHaveTextContent("com.x.demo");
    expect(onDisk.get("com.x.demo")?.version).toBe("2.0.0");
  });

  it("an update whose landed files cannot be removed again stays, listed and loaded", async () => {
    expectConsole(/Plugin operation failed/);
    const landing = deferred();
    let locked = false;
    serveMarket(update);
    const onDisk = pluginsFolder(installedPlugin({ version: "2.0.0" }), {
      installed: [installedPlugin()],
      landing: () => landing.promise,
      locked: () => locked,
    });
    const installs = await mountOvertake("com.x.demo", (p) => p.installFromRegistry(update));

    await press("install");
    await waitFor(() => expect(installsRequested()).toBe(1));
    await press("uninstall");
    locked = true;
    await act(async () => {
      landing.resolve();
      await Promise.all(installs);
    });

    // Better on screen, where it can be removed again, than on disk unlisted.
    expect(screen.getByText("Plugin error: locked")).toBeInTheDocument();
    expect(screen.getByTestId("installed").textContent).toBe("com.x.demo@2.0.0");
    expect(screen.getByTestId("loaded")).toHaveTextContent("com.x.demo");
    expect(onDisk.get("com.x.demo")?.version).toBe("2.0.0");
  });

  // "The update looks stuck": Remove, then Install again from the marketplace.
  // The update that was already on its way must not take the new install out.
  // The removal revoked the grant, so the second install asks for consent
  // again, and the dialog mock's default answer accepts it.
  it.each([
    ["older", [0, 1]],
    ["newer", [1, 0]],
  ] as const)(
    "a plugin installed again after its removal stays when the %s install lands first",
    async (_first, order) => {
      const landings = [deferred(), deferred()];
      serveMarket(update);
      const onDisk = pluginsFolder(installedPlugin({ version: "2.0.0" }), {
        installed: [installedPlugin()],
        landing: () => landings[installsRequested() - 1].promise,
      });
      const installs = await mountOvertake("com.x.demo", (p) => p.installFromRegistry(update));

      await press("install");
      await waitFor(() => expect(installsRequested()).toBe(1));
      await press("uninstall");
      await press("install");
      await waitFor(() => expect(installsRequested()).toBe(2));
      await act(async () => {
        for (const which of order) {
          landings[which].resolve();
          await installs[which];
        }
      });

      expect(screen.getByTestId("installed").textContent).toBe("com.x.demo@2.0.0");
      expect(screen.getByTestId("loaded")).toHaveTextContent("com.x.demo");
      expect([...onDisk.keys()]).toEqual(["com.x.demo"]);
    },
  );

  it("installs a plugin that was removed before the install began", async () => {
    const slow = installedPlugin({ id: "com.x.slow", name: "Slow" });
    const onDisk = pluginsFolder(slow);
    const installs = await mountOvertake(slow.id, starts.registry);

    await press("uninstall");
    await act(async () => {
      screen.getByRole("button", { name: "install" }).click();
      await Promise.all(installs);
    });

    expect(screen.getByTestId("loaded")).toHaveTextContent("com.x.slow");
    expect([...onDisk.keys()]).toEqual(["com.x.slow"]);
  });
});

describe("PluginsProvider updates overtaken by a disable", () => {
  const update = marketEntry("com.x.demo", "Demo", "2.0.0");
  const v2Source = `export default {
    activate(ctx) {
      ctx.commands.register({ id: "demo.v2", title: "Say Hi", run() {} });
    },
  };`;

  /** Starts an update of the installed demo plugin, held just short of the disk. */
  async function startHeldUpdate() {
    const landing = deferred();
    serveMarket(update);
    pluginsFolder(installedPlugin({ version: "2.0.0", mainSource: v2Source }), {
      installed: [installedPlugin()],
      landing: () => landing.promise,
    });
    const installs = await mountOvertake("com.x.demo", (p) => p.installFromRegistry(update));

    await press("install");
    await waitFor(() => expect(installsRequested()).toBe(1));
    return () =>
      act(async () => {
        landing.resolve();
        await Promise.all(installs);
      });
  }

  it("an update that a disable overtook shows the new version, still disabled", async () => {
    const openGate = gateActivation();
    serveMarket(update);
    // A second installed plugin, so the recovery must touch only the one it
    // was handed. com.x.broken is pre-granted by the harness.
    const other = installedPlugin({
      id: "com.x.broken",
      name: "Other",
      mainSource: "export default { activate() {} };",
    });
    pluginsFolder(installedPlugin({ version: "2.0.0", mainSource: gatedSource }), {
      installed: [installedPlugin(), other],
    });
    const installs = await mountOvertake("com.x.demo", (p) => p.installFromRegistry(update));
    vi.mocked(loadPluginSettings).mockClear();

    await press("install");
    await waitFor(() => expect(loadPluginSettings).toHaveBeenCalledWith("com.x.demo"));
    await press("off");
    await act(async () => {
      openGate();
      await Promise.all(installs);
    });

    // The load lost the race, so it must not re-enable the plugin, and must not
    // leave the old version on screen either: it is gone from disk.
    expect(screen.getByTestId("installed").textContent).toBe("com.x.demo@2.0.0,com.x.broken@1.0.0");
    expect(screen.getByTestId("disabled")).toHaveTextContent("com.x.demo");
    expect(screen.getByTestId("loaded").textContent).toBe("com.x.broken");
  });

  it("an update that a disable overtook before it landed shows the new version, still disabled", async () => {
    const land = await startHeldUpdate();
    await press("off");
    await land();

    expect(screen.getByTestId("installed").textContent).toBe("com.x.demo@2.0.0");
    expect(screen.getByTestId("disabled")).toHaveTextContent("com.x.demo");
    expect(screen.getByTestId("loaded").textContent).toBe("");
    expect(screen.getByTestId("commands").textContent).toBe("");
  });

  it("an update lands enabled when the disable that overtook it was taken back", async () => {
    const land = await startHeldUpdate();
    await press("off");
    await press("on");
    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("com.x.demo"));
    await land();

    expect(screen.getByTestId("installed").textContent).toBe("com.x.demo@2.0.0");
    expect(screen.getByTestId("disabled").textContent).toBe("");
    // The new version's code is what runs, not the one switched back on meanwhile.
    expect(screen.getByTestId("commands").textContent).toBe("demo.v2");
  });

  it("an update of a plugin turned off before it began still turns it on", async () => {
    serveMarket(update);
    pluginsFolder(installedPlugin({ version: "2.0.0", mainSource: v2Source }), {
      installed: [installedPlugin()],
    });
    const installs = await mountOvertake("com.x.demo", (p) => p.installFromRegistry(update));

    await press("off");
    await act(async () => {
      screen.getByRole("button", { name: "install" }).click();
      await Promise.all(installs);
    });

    expect(screen.getByTestId("disabled").textContent).toBe("");
    expect(screen.getByTestId("commands").textContent).toBe("demo.v2");
  });
});
