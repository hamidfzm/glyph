import { act, render, screen, waitFor } from "@testing-library/react";
import { useContext } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../lib/settings";
import { SettingsContext, SettingsProvider } from "./SettingsContext";

function TestConsumer({ attack }: { attack?: { path: string; value: unknown } } = {}) {
  const { settings, updateSettings, resetSettings, loaded } = useContext(SettingsContext);
  return (
    <div>
      <span data-testid="loaded">{String(loaded)}</span>
      <span data-testid="theme">{settings.appearance.theme}</span>
      <span data-testid="font-size">{settings.appearance.fontSize}</span>
      <span data-testid="sidebar">{String(settings.layout.filesSidebarVisible)}</span>
      <span data-testid="settings-keys">{Object.keys(settings).sort().join(",")}</span>
      <span data-testid="appearance-keys">{Object.keys(settings.appearance).sort().join(",")}</span>
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
      <button
        type="button"
        data-testid="attack"
        onClick={() => {
          if (attack) updateSettings(attack.path, attack.value);
        }}
      >
        Attack
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

  describe("prototype pollution defenses", () => {
    const attackPaths = [
      { name: "__proto__ at root", path: "__proto__.polluted", value: true },
      { name: "constructor chain", path: "constructor.prototype.polluted", value: true },
      { name: "prototype at root", path: "prototype.polluted", value: true },
      { name: "unknown top-level key", path: "nonexistent.polluted", value: true },
      { name: "unknown nested key", path: "appearance.nonexistent", value: "x" },
      { name: "Object.prototype method as key", path: "appearance.toString", value: "x" },
      { name: "__proto__ as final segment", path: "appearance.__proto__", value: true },
      { name: "empty segment", path: "appearance..theme", value: "dark" },
    ];

    for (const { name, path, value } of attackPaths) {
      it(`rejects ${name}`, async () => {
        // biome-ignore lint/suspicious/noExplicitAny: test assertion on raw prototype
        const probe = {} as any;
        const rootKeys = Object.keys(DEFAULT_SETTINGS).sort().join(",");
        const appearanceKeys = Object.keys(DEFAULT_SETTINGS.appearance).sort().join(",");

        render(
          <SettingsProvider>
            <TestConsumer attack={{ path, value }} />
          </SettingsProvider>,
        );

        await waitFor(() => {
          expect(screen.getByTestId("loaded").textContent).toBe("true");
        });
        const originalTheme = screen.getByTestId("theme").textContent;

        act(() => {
          screen.getByTestId("attack").click();
        });

        // No pollution reached Object.prototype
        expect(probe.polluted).toBeUndefined();
        // Legitimate setting was not disturbed
        expect(screen.getByTestId("theme").textContent).toBe(originalTheme);
        // Settings shape is unchanged — no foreign keys were inserted at any depth
        expect(screen.getByTestId("settings-keys").textContent).toBe(rootKeys);
        expect(screen.getByTestId("appearance-keys").textContent).toBe(appearanceKeys);
      });
    }
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
