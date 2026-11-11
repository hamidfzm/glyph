import { listen } from "@tauri-apps/api/event";
import type { getStore } from "@tauri-apps/plugin-store";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useContext } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsContext } from "@/contexts/SettingsContext";
import { SettingsProvider } from "@/contexts/SettingsProvider";
import type { Settings } from "@/lib/settings";
import { SETTINGS_SYNCED_EVENT } from "@/lib/settingsSync";
import { expectConsole } from "@/test/consoleGuard";
import { mockedGetStore, resetSettingsDom } from "@/test/settingsHarness";

// A settings sync rewrites settings.json from Rust and then tells every window.
// Each window reloads, keeping what it has not written yet.

const handlers = new Map<string, () => void>();

beforeEach(() => {
  vi.clearAllMocks();
  resetSettingsDom();
  handlers.clear();
  vi.mocked(listen).mockImplementation(((event: string, handler: () => void) => {
    handlers.set(event, handler);
    return Promise.resolve(() => {});
  }) as unknown as typeof listen);
});

function liveStore(initial: unknown) {
  let contents = initial;
  const get = vi.fn(async () => contents);
  const set = vi.fn(async (_key: string, value: unknown) => {
    contents = value;
  });
  const save = vi.fn(async () => {});
  mockedGetStore.mockResolvedValueOnce({ get, set, save } as unknown as Awaited<
    ReturnType<typeof getStore>
  >);
  return {
    get,
    syncWrites(next: unknown) {
      contents = next;
    },
  };
}

function Consumer() {
  const { settings, updateSettings, loaded } = useContext(SettingsContext);
  return (
    <div>
      <span data-testid="loaded">{String(loaded)}</span>
      <span data-testid="theme">{settings.appearance.theme}</span>
      <span data-testid="font">{settings.appearance.fontSize}</span>
      <span data-testid="key">{settings.ai.apiKeys.claude ?? ""}</span>
      <button type="button" onClick={() => updateSettings("appearance.fontSize", 21)}>
        bigger
      </button>
    </div>
  );
}

async function renderLoaded() {
  render(
    <SettingsProvider>
      <Consumer />
    </SettingsProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("loaded").textContent).toBe("true"));
  await waitFor(() => expect(handlers.has(SETTINGS_SYNCED_EVENT)).toBe(true));
}

function announceSync() {
  act(() => handlers.get(SETTINGS_SYNCED_EVENT)?.());
}

describe("SettingsProvider after a settings sync", () => {
  it("shows the settings the sync wrote", async () => {
    const store = liveStore({ appearance: { theme: "light", fontSize: 16 } });
    await renderLoaded();
    store.syncWrites({ appearance: { theme: "dark", fontSize: 18 } });
    announceSync();
    await waitFor(() => expect(screen.getByTestId("theme").textContent).toBe("dark"));
    expect(screen.getByTestId("font").textContent).toBe("18");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("keeps an edit this window has not written yet", async () => {
    const store = liveStore({ appearance: { theme: "light", fontSize: 16 } });
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "bigger" }));
    store.syncWrites({ appearance: { theme: "dark", fontSize: 14 } });
    announceSync();
    await waitFor(() => expect(screen.getByTestId("theme").textContent).toBe("dark"));
    expect(screen.getByTestId("font").textContent).toBe("21");
  });

  it("keeps the API keys, which the store never holds", async () => {
    const store = liveStore({ ai: { apiKeys: { claude: "sk-local" } } });
    await renderLoaded();
    expect(screen.getByTestId("key").textContent).toBe("sk-local");
    store.syncWrites({ appearance: { theme: "dark" } as Partial<Settings["appearance"]> });
    announceSync();
    await waitFor(() => expect(screen.getByTestId("theme").textContent).toBe("dark"));
    expect(screen.getByTestId("key").textContent).toBe("sk-local");
  });

  it("lets the newest reload win when two overlap", async () => {
    const store = liveStore({ appearance: { theme: "light" } });
    await renderLoaded();
    let releaseFirst: (value: unknown) => void = () => {};
    store.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseFirst = resolve;
        }),
    );
    announceSync();
    store.syncWrites({ appearance: { theme: "dark" } });
    announceSync();
    await waitFor(() => expect(screen.getByTestId("theme").textContent).toBe("dark"));
    await act(async () => releaseFirst({ appearance: { theme: "system" } }));
    expect(screen.getByTestId("theme").textContent).toBe("dark");
  });

  it("reports a reload that fails and keeps what it shows", async () => {
    expectConsole(/Failed to reload synced settings/);
    const store = liveStore({ appearance: { theme: "light" } });
    await renderLoaded();
    store.get.mockRejectedValueOnce(new Error("store closed"));
    announceSync();
    await waitFor(() => expect(store.get).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("theme").textContent).toBe("light");
  });

  it("has nothing to reload when the store never opened", async () => {
    expectConsole(/Failed to load settings/);
    mockedGetStore.mockRejectedValueOnce(new Error("not opened"));
    await renderLoaded();
    announceSync();
    expect(screen.getByTestId("theme").textContent).toBe("system");
  });

  it("does not listen before the stored settings loaded", async () => {
    let resolveLoad: (store: unknown) => void = () => {};
    mockedGetStore.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve as (store: unknown) => void;
        }),
    );
    render(
      <SettingsProvider>
        <Consumer />
      </SettingsProvider>,
    );
    expect(handlers.has(SETTINGS_SYNCED_EVENT)).toBe(false);
    await act(async () =>
      resolveLoad({ get: vi.fn(async () => null), set: vi.fn(), save: vi.fn() }),
    );
    await waitFor(() => expect(handlers.has(SETTINGS_SYNCED_EVENT)).toBe(true));
  });
});
