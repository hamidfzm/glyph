import { setTheme } from "@tauri-apps/api/app";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsProvider } from "@/contexts/SettingsProvider";
import {
  realMatchMedia,
  resetSettingsDom,
  TestConsumer,
  UpdateConsumer,
} from "@/test/settingsHarness";

beforeEach(() => {
  vi.clearAllMocks();
  resetSettingsDom();
});

describe("SettingsProvider appearance", () => {
  describe("theme application", () => {
    afterEach(() => {
      window.matchMedia = realMatchMedia;
    });

    it("adds the dark class when system prefers dark on mount", async () => {
      window.matchMedia = vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }) as unknown as typeof window.matchMedia;

      render(
        <SettingsProvider>
          <TestConsumer />
        </SettingsProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId("loaded").textContent).toBe("true");
      });
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });

    it("toggles the dark class when updating an explicit theme", async () => {
      render(
        <SettingsProvider>
          <UpdateConsumer
            updates={[
              ["appearance.theme", "dark"],
              ["appearance.theme", "light"],
            ]}
          />
        </SettingsProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId("loaded").textContent).toBe("true");
      });

      act(() => screen.getByTestId("update-0").click());
      expect(document.documentElement.classList.contains("dark")).toBe(true);

      act(() => screen.getByTestId("update-1").click());
      expect(document.documentElement.classList.contains("dark")).toBe(false);
    });

    it("syncs the native window theme with the theme setting", async () => {
      const mockedSetTheme = vi.mocked(setTheme);
      mockedSetTheme.mockClear();

      render(
        <SettingsProvider>
          <UpdateConsumer
            updates={[
              ["appearance.theme", "dark"],
              ["appearance.theme", "light"],
              ["appearance.theme", "system"],
            ]}
          />
        </SettingsProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId("loaded").textContent).toBe("true");
      });
      // Mount applies the stored theme (system) to the native window too.
      expect(mockedSetTheme).toHaveBeenCalledWith(null);

      act(() => screen.getByTestId("update-0").click());
      expect(mockedSetTheme).toHaveBeenLastCalledWith("dark");

      act(() => screen.getByTestId("update-1").click());
      expect(mockedSetTheme).toHaveBeenLastCalledWith("light");

      act(() => screen.getByTestId("update-2").click());
      expect(mockedSetTheme).toHaveBeenLastCalledWith(null);
    });

    it("logs and keeps going when the native theme call fails", async () => {
      vi.mocked(setTheme).mockRejectedValueOnce(new Error("unsupported"));
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      render(
        <SettingsProvider>
          <TestConsumer />
        </SettingsProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId("loaded").textContent).toBe("true");
      });
      await waitFor(() => {
        expect(errSpy).toHaveBeenCalledWith(
          "Failed to set the native window theme:",
          expect.any(Error),
        );
      });
      errSpy.mockRestore();
    });

    it("reacts to system theme changes while on the system theme", async () => {
      let changeHandler: ((e: { matches: boolean }) => void) | undefined;
      const addEventListener = vi.fn((_evt: string, handler: (e: { matches: boolean }) => void) => {
        changeHandler = handler;
      });
      const removeEventListener = vi.fn();
      window.matchMedia = vi.fn().mockReturnValue({
        matches: false,
        addEventListener,
        removeEventListener,
      }) as unknown as typeof window.matchMedia;

      const { unmount } = render(
        <SettingsProvider>
          <TestConsumer />
        </SettingsProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId("loaded").textContent).toBe("true");
      });
      expect(addEventListener).toHaveBeenCalledWith("change", expect.any(Function));

      act(() => changeHandler?.({ matches: true }));
      expect(document.documentElement.classList.contains("dark")).toBe(true);

      act(() => changeHandler?.({ matches: false }));
      expect(document.documentElement.classList.contains("dark")).toBe(false);

      unmount();
      expect(removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
    });
  });

  describe("CSS variable application", () => {
    const root = () => document.documentElement.style;

    async function renderWithUpdates(updates: Array<[string, unknown]>) {
      render(
        <SettingsProvider>
          <UpdateConsumer updates={updates} />
        </SettingsProvider>,
      );
      await waitFor(() => {
        expect(screen.getByTestId("loaded").textContent).toBe("true");
      });
      for (let i = 0; i < updates.length; i++) {
        act(() => screen.getByTestId(`update-${i}`).click());
      }
    }

    it("maps a named font family to its stack", async () => {
      await renderWithUpdates([["appearance.fontFamily", "serif"]]);
      expect(root().getPropertyValue("--glyph-reading-font")).toContain("Iowan Old Style");
      // Chrome stays on the per-platform stack from platform.css.
      expect(root().getPropertyValue("--glyph-font")).toBe("");
    });

    it("uses the custom font when fontFamily is custom", async () => {
      await renderWithUpdates([
        ["appearance.customFont", "Comic Sans MS"],
        ["appearance.fontFamily", "custom"],
      ]);
      expect(root().getPropertyValue("--glyph-reading-font")).toBe("Comic Sans MS");
    });

    it("clears the override for system, leaving the stylesheet reading serif", async () => {
      await renderWithUpdates([
        ["appearance.fontFamily", "serif"],
        ["appearance.fontFamily", "system"],
      ]);
      expect(root().getPropertyValue("--glyph-reading-font")).toBe("");
    });

    it("clears a previous face when custom is chosen with no font named", async () => {
      // Without clearing, prose would stay stranded on the serif while the
      // settings say "custom" with an empty name.
      await renderWithUpdates([
        ["appearance.fontFamily", "serif"],
        ["appearance.fontFamily", "custom"],
      ]);
      expect(root().getPropertyValue("--glyph-reading-font")).toBe("");
    });

    it("sets the code font", async () => {
      await renderWithUpdates([["appearance.codeFont", "Fira Code"]]);
      expect(root().getPropertyValue("--glyph-code-font")).toBe("Fira Code");
    });

    it("clears the code font when emptied", async () => {
      await renderWithUpdates([
        ["appearance.codeFont", "Fira Code"],
        ["appearance.codeFont", ""],
      ]);
      expect(root().getPropertyValue("--glyph-code-font")).toBe("");
    });

    it("falls back to defaults for unknown line height and content width", async () => {
      await renderWithUpdates([
        ["appearance.lineHeight", "bogus"],
        ["appearance.contentWidth", "bogus"],
      ]);
      expect(root().getPropertyValue("--glyph-line-height")).toBe("1.7");
      expect(root().getPropertyValue("--glyph-content-width")).toBe("800px");
    });
  });
});
