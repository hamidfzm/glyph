import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsProvider } from "@/contexts/SettingsProvider";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import {
  mockedLoad,
  mockStore,
  realMatchMedia,
  resetSettingsDom,
  TestConsumer,
} from "@/test/settingsHarness";

beforeEach(() => {
  vi.clearAllMocks();
  resetSettingsDom();
});

describe("loading persisted settings", () => {
  afterEach(() => {
    window.matchMedia = realMatchMedia;
  });

  it("merges saved settings over defaults on mount", async () => {
    mockStore({
      appearance: { theme: "dark", fontSize: 22 },
      layout: { filesSidebarVisible: false },
    });

    render(
      <SettingsProvider>
        <TestConsumer />
      </SettingsProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loaded").textContent).toBe("true");
    });

    // Saved values win, untouched keys keep their defaults, shape is intact.
    expect(screen.getByTestId("theme").textContent).toBe("dark");
    expect(screen.getByTestId("font-size").textContent).toBe("22");
    expect(screen.getByTestId("sidebar").textContent).toBe("false");
    expect(screen.getByTestId("appearance-keys").textContent).toBe(
      Object.keys(DEFAULT_SETTINGS.appearance).sort().join(","),
    );
    // Side effects reflect the merged settings.
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.getPropertyValue("--glyph-font-size")).toBe("22px");
  });

  it("falls back to defaults and logs when loading fails", async () => {
    mockedLoad.mockRejectedValueOnce(new Error("store unavailable"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <SettingsProvider>
        <TestConsumer />
      </SettingsProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loaded").textContent).toBe("true");
    });

    expect(errSpy).toHaveBeenCalledWith("Failed to load settings:", expect.any(Error));
    expect(screen.getByTestId("theme").textContent).toBe("system");
    expect(document.documentElement.style.getPropertyValue("--glyph-font-size")).toBe("16px");
    errSpy.mockRestore();
  });

  it("does not render children until the store has loaded (#490)", async () => {
    const { resolveLoad } = mockStore({ appearance: { fontSize: 22 } }, { deferLoad: true });

    render(
      <SettingsProvider>
        <TestConsumer />
      </SettingsProvider>,
    );

    // While the load is pending no consumer is mounted, so nothing can read
    // DEFAULT_SETTINGS and persist it over the user's stored settings.
    expect(screen.queryByTestId("loaded")).toBeNull();

    await act(async () => {
      resolveLoad();
    });

    await waitFor(() => {
      expect(screen.getByTestId("loaded").textContent).toBe("true");
    });
    // Children mount straight into the merged settings, never the defaults.
    expect(screen.getByTestId("font-size").textContent).toBe("22");
  });

  it("does not apply settings when unmounted before the load resolves", async () => {
    mockStore({ appearance: { theme: "dark" } });

    const { unmount } = render(
      <SettingsProvider>
        <TestConsumer />
      </SettingsProvider>,
    );

    // Tear down before the async load's microtasks flush, then let them run.
    // The cancelled guards must suppress setSettings / setLoaded and any DOM
    // side effects.
    unmount();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
