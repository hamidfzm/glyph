import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsProvider } from "@/contexts/SettingsProvider";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { resetSettingsDom, TestConsumer } from "@/test/settingsHarness";

beforeEach(() => {
  vi.clearAllMocks();
  resetSettingsDom();
});

describe("SettingsProvider", () => {
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
