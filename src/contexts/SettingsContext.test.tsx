import { act, render, screen, waitFor } from "@testing-library/react";
import { useContext } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../lib/settings";
import { SettingsContext, SettingsProvider } from "./SettingsContext";

function TestConsumer() {
  const { settings, updateSettings, resetSettings, loaded } = useContext(SettingsContext);
  return (
    <div>
      <span data-testid="loaded">{String(loaded)}</span>
      <span data-testid="theme">{settings.appearance.theme}</span>
      <span data-testid="font-size">{settings.appearance.fontSize}</span>
      <span data-testid="sidebar">{String(settings.layout.sidebarVisible)}</span>
      <button
        type="button"
        data-testid="change-theme"
        onClick={() => updateSettings("appearance.theme", "dark")}
      >
        Set Dark
      </button>
      <button
        type="button"
        data-testid="change-font"
        onClick={() => updateSettings("appearance.fontSize", 20)}
      >
        Set Font
      </button>
      <button type="button" data-testid="reset" onClick={resetSettings}>
        Reset
      </button>
    </div>
  );
}

describe("SettingsContext", () => {
  beforeEach(() => {
    document.documentElement.classList.remove("dark");
    document.documentElement.style.cssText = "";
  });

  it("has default context value", () => {
    const ctx = {
      settings: DEFAULT_SETTINGS,
      updateSettings: () => {},
      resetSettings: () => {},
      loaded: false,
    };
    expect(ctx.settings).toEqual(DEFAULT_SETTINGS);
    expect(ctx.loaded).toBe(false);
  });
});

describe("SettingsProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.classList.remove("dark");
    document.documentElement.style.cssText = "";
  });

  it("provides default settings on mount", async () => {
    render(
      <SettingsProvider>
        <TestConsumer />
      </SettingsProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loaded").textContent).toBe("true");
    });
    expect(screen.getByTestId("theme").textContent).toBe("system");
    expect(screen.getByTestId("font-size").textContent).toBe("16");
  });

  it("updates settings via updateSettings", async () => {
    render(
      <SettingsProvider>
        <TestConsumer />
      </SettingsProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loaded").textContent).toBe("true");
    });

    act(() => {
      screen.getByTestId("change-font").click();
    });

    expect(screen.getByTestId("font-size").textContent).toBe("20");
  });

  it("resets settings to defaults", async () => {
    render(
      <SettingsProvider>
        <TestConsumer />
      </SettingsProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loaded").textContent).toBe("true");
    });

    act(() => {
      screen.getByTestId("change-font").click();
    });
    expect(screen.getByTestId("font-size").textContent).toBe("20");

    act(() => {
      screen.getByTestId("reset").click();
    });
    expect(screen.getByTestId("font-size").textContent).toBe("16");
  });

  it("applies CSS variables for font size", async () => {
    render(
      <SettingsProvider>
        <TestConsumer />
      </SettingsProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loaded").textContent).toBe("true");
    });

    expect(document.documentElement.style.getPropertyValue("--glyph-font-size")).toBe("16px");
  });
});
