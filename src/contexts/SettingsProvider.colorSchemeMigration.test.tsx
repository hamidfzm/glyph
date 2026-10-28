import type { getStore } from "@tauri-apps/plugin-store";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useContext } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsContext } from "@/contexts/SettingsContext";
import { SettingsProvider } from "@/contexts/SettingsProvider";
import type { Settings } from "@/lib/settings";
import { expectConsole } from "@/test/consoleGuard";
import { mockedGetStore, resetSettingsDom } from "@/test/settingsHarness";

// The theme presets plugin kept its pick in plugins.json; the first launch
// after the move carries it into settings.json, through the real plugin
// settings store.

const PLUGIN = "glyph.core.theme-presets";

function ColorSchemeConsumer() {
  const { settings, resetSettings, loaded } = useContext(SettingsContext);
  return (
    <div>
      <span data-testid="loaded">{String(loaded)}</span>
      <span data-testid="scheme">{settings.appearance.colorScheme.id}</span>
      <button type="button" onClick={resetSettings}>
        Reset
      </button>
    </div>
  );
}

function mockStores(
  storedSettings: Partial<Settings> | null,
  pluginSettings: Record<string, unknown>,
  { settingsWriteFails = false } = {},
) {
  let settingsFile = storedSettings;
  let pluginsFile = { [PLUGIN]: pluginSettings };
  const events: string[] = [];
  const settingsStore = {
    get: vi.fn(async () => settingsFile),
    set: vi.fn(async (_key: string, value: Partial<Settings>) => {
      if (settingsWriteFails) throw new Error("disk full");
      settingsFile = value;
    }),
    save: vi.fn(async () => {
      events.push("settings saved");
    }),
  };
  const pluginsStore = {
    get: vi.fn(async () => pluginsFile),
    set: vi.fn(async (_key: string, value: typeof pluginsFile) => {
      pluginsFile = value;
      events.push("plugins saved");
    }),
    save: vi.fn(async () => {}),
  };
  mockedGetStore.mockImplementation(
    async (file) =>
      (file === "settings.json" ? settingsStore : pluginsStore) as unknown as Awaited<
        ReturnType<typeof getStore>
      >,
  );
  return {
    events,
    settingsStore,
    pluginsStore,
    settingsFile: () => settingsFile,
    pluginsFile: () => pluginsFile,
  };
}

async function renderLoaded() {
  render(
    <SettingsProvider>
      <ColorSchemeConsumer />
    </SettingsProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("loaded").textContent).toBe("true"));
}

beforeEach(() => {
  vi.clearAllMocks();
  resetSettingsDom();
});

afterEach(() => mockedGetStore.mockReset());

describe("SettingsProvider color scheme migration", () => {
  it("carries the picked preset over, and drops it from plugins.json once settings.json has it", async () => {
    const stores = mockStores(
      { appearance: { theme: "dark" } as Settings["appearance"] },
      {
        preset: "sepia",
      },
    );

    await renderLoaded();

    expect(screen.getByTestId("scheme").textContent).toBe(`${PLUGIN}:sepia`);
    await waitFor(() => expect(stores.events).toEqual(["settings saved", "plugins saved"]));
    expect(stores.settingsFile()?.appearance).toMatchObject({
      theme: "dark",
      colorScheme: { id: `${PLUGIN}:sepia`, label: "Sepia" },
    });
    expect(stores.pluginsFile()).toEqual({ [PLUGIN]: {} });
  });

  it("keeps the preset in plugins.json when the settings write fails", async () => {
    expectConsole(/Failed to save settings/);
    const stores = mockStores(null, { preset: "solarized" }, { settingsWriteFails: true });

    await renderLoaded();
    await waitFor(() => expect(stores.settingsStore.set).toHaveBeenCalled());
    await act(async () => {});

    expect(screen.getByTestId("scheme").textContent).toBe(`${PLUGIN}:solarized`);
    expect(stores.pluginsStore.set).not.toHaveBeenCalled();
    expect(stores.pluginsFile()).toEqual({ [PLUGIN]: { preset: "solarized" } });
  });

  it("changes nothing once the settings hold a color scheme", async () => {
    const colorScheme = { id: "default", label: "" };
    const stores = mockStores(
      { appearance: { colorScheme } as Settings["appearance"] },
      { preset: "sepia" },
    );

    await renderLoaded();
    await act(async () => {});

    expect(screen.getByTestId("scheme").textContent).toBe("default");
    expect(stores.pluginsStore.get).not.toHaveBeenCalled();
    expect(stores.settingsStore.set).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown preset", { preset: "neon" }],
    ["no preset", {}],
  ])("leaves Default for %s", async (_, pluginSettings) => {
    const stores = mockStores(null, pluginSettings);

    await renderLoaded();
    await act(async () => {});

    expect(screen.getByTestId("scheme").textContent).toBe("default");
    expect(stores.settingsStore.set).not.toHaveBeenCalled();
    expect(stores.pluginsStore.set).not.toHaveBeenCalled();
  });

  it("keeps the carried-over scheme when the preset cannot be removed", async () => {
    expectConsole(/Failed to remove the carried-over theme preset/);
    const stores = mockStores(null, { preset: "sepia" });
    stores.pluginsStore.set.mockRejectedValue(new Error("locked"));

    await renderLoaded();
    await waitFor(() => expect(stores.pluginsStore.set).toHaveBeenCalled());

    expect(screen.getByTestId("scheme").textContent).toBe(`${PLUGIN}:sepia`);
    expect(stores.settingsFile()?.appearance?.colorScheme).toEqual({
      id: `${PLUGIN}:sepia`,
      label: "Sepia",
    });
  });

  it("loads Default when plugins.json cannot be read", async () => {
    const stores = mockStores(null, { preset: "sepia" });
    stores.pluginsStore.get.mockRejectedValue(new Error("unreadable"));

    await renderLoaded();

    expect(screen.getByTestId("scheme").textContent).toBe("default");
  });

  it("resets a carried-over scheme to Default", async () => {
    const stores = mockStores(null, { preset: "high-contrast" });
    await renderLoaded();
    await waitFor(() => expect(stores.events).toContain("plugins saved"));

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(screen.getByTestId("scheme").textContent).toBe("default");
  });
});
