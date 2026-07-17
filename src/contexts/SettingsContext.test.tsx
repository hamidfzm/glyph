import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import { act, render, screen, waitFor } from "@testing-library/react";
import { useContext, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { SettingsContext } from "./SettingsContext";
import { SettingsProvider } from "./SettingsProvider";

const mockedLoad = vi.mocked(load);
const realMatchMedia = window.matchMedia;

// Builds a fake store whose `get` resolves the given saved value, registered as
// the next `load()` result. Returns the `set` and `save` spies so tests can
// assert persisted writes.
function mockStore(saved: unknown, { setRejects = false } = {}) {
  const set = vi.fn(() =>
    setRejects ? Promise.reject(new Error("disk full")) : Promise.resolve(),
  );
  const save = vi.fn(() => Promise.resolve());
  const get = vi.fn(() => Promise.resolve(saved));
  mockedLoad.mockResolvedValueOnce({ get, set, save } as unknown as Awaited<
    ReturnType<typeof load>
  >);
  return { get, set, save };
}

// Generic consumer that fires a sequence of updateSettings(path, value) calls,
// one per button, so tests can drive applyTheme / applyCSSVariables branches.
function UpdateConsumer({ updates }: { updates: Array<[string, unknown]> }) {
  const { updateSettings, loaded } = useContext(SettingsContext);
  return (
    <div>
      <span data-testid="loaded">{String(loaded)}</span>
      {updates.map(([path, value], i) => (
        <button
          // biome-ignore lint/suspicious/noArrayIndexKey: stable, render-only list
          key={i}
          type="button"
          data-testid={`update-${i}`}
          onClick={() => updateSettings(path, value)}
        >
          update
        </button>
      ))}
    </div>
  );
}

// Drives updateSettings + flushSettings so tests can exercise the pending-write
// queue: two font-size updates, a flush whose boolean result is rendered.
function FlushConsumer() {
  const { updateSettings, flushSettings, loaded } = useContext(SettingsContext);
  const [flushResult, setFlushResult] = useState("");
  return (
    <div>
      <span data-testid="loaded">{String(loaded)}</span>
      <span data-testid="flush-result">{flushResult}</span>
      <button
        type="button"
        data-testid="update-font"
        onClick={() => updateSettings("appearance.fontSize", 21)}
      >
        first update
      </button>
      <button
        type="button"
        data-testid="update-font-again"
        onClick={() => updateSettings("appearance.fontSize", 22)}
      >
        second update
      </button>
      <button
        type="button"
        data-testid="flush"
        onClick={async () => setFlushResult(String(await flushSettings()))}
      >
        flush
      </button>
    </div>
  );
}

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
      <span data-testid="claude-key">{settings.ai.apiKeys.claude ?? ""}</span>
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

  it("exposes no-op handlers and defaults without a provider", () => {
    render(<TestConsumer />);
    expect(screen.getByTestId("loaded").textContent).toBe("false");
    expect(screen.getByTestId("theme").textContent).toBe("system");
    // The default updateSettings / resetSettings are inert no-ops.
    act(() => screen.getByTestId("change-font").click());
    act(() => screen.getByTestId("reset").click());
    expect(screen.getByTestId("font-size").textContent).toBe("16");
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
      expect(root().getPropertyValue("--glyph-font")).toContain("Georgia");
    });

    it("uses the custom font when fontFamily is custom", async () => {
      await renderWithUpdates([
        ["appearance.customFont", "Comic Sans MS"],
        ["appearance.fontFamily", "custom"],
      ]);
      expect(root().getPropertyValue("--glyph-font")).toBe("Comic Sans MS");
    });

    it("removes the font property when fontFamily is system", async () => {
      await renderWithUpdates([
        ["appearance.fontFamily", "serif"],
        ["appearance.fontFamily", "system"],
      ]);
      expect(root().getPropertyValue("--glyph-font")).toBe("");
    });

    it("leaves the font unset for custom family with no custom font", async () => {
      // custom + empty customFont skips the custom branch, and "custom" has no
      // entry in FONT_FAMILY_MAP, so nothing is written.
      await renderWithUpdates([["appearance.fontFamily", "custom"]]);
      expect(root().getPropertyValue("--glyph-font")).toBe("");
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

  describe("persisting changes", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("debounces writes to the store", async () => {
      const { set } = mockStore(null);

      render(
        <SettingsProvider>
          <UpdateConsumer updates={[["appearance.fontSize", 19]]} />
        </SettingsProvider>,
      );
      await waitFor(() => {
        expect(screen.getByTestId("loaded").textContent).toBe("true");
      });

      vi.useFakeTimers();
      act(() => screen.getByTestId("update-0").click());
      expect(set).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(500);
        await Promise.resolve();
      });

      expect(set).toHaveBeenCalledWith(
        "settings",
        expect.objectContaining({
          appearance: expect.objectContaining({ fontSize: 19 }),
        }),
      );
    });

    it("logs and swallows store write errors", async () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockStore(null, { setRejects: true });

      render(
        <SettingsProvider>
          <UpdateConsumer updates={[["appearance.fontSize", 18]]} />
        </SettingsProvider>,
      );
      await waitFor(() => {
        expect(screen.getByTestId("loaded").textContent).toBe("true");
      });

      vi.useFakeTimers();
      act(() => screen.getByTestId("update-0").click());
      await act(async () => {
        vi.advanceTimersByTime(500);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(errSpy).toHaveBeenCalledWith("Failed to save settings:", expect.any(Error));
      errSpy.mockRestore();
    });

    it("persists a reset to the store", async () => {
      const { set } = mockStore(null);

      render(
        <SettingsProvider>
          <TestConsumer />
        </SettingsProvider>,
      );
      await waitFor(() => {
        expect(screen.getByTestId("loaded").textContent).toBe("true");
      });

      vi.useFakeTimers();
      act(() => screen.getByTestId("reset").click());
      await act(async () => {
        vi.advanceTimersByTime(500);
        await Promise.resolve();
      });

      expect(set).toHaveBeenCalledWith("settings", DEFAULT_SETTINGS);
    });
  });

  describe("flushSettings", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    async function renderFlushConsumer() {
      const view = render(
        <SettingsProvider>
          <FlushConsumer />
        </SettingsProvider>,
      );
      await waitFor(() => {
        expect(screen.getByTestId("loaded").textContent).toBe("true");
      });
      return view;
    }

    it("persists an update still inside the debounce window", async () => {
      const { set, save } = mockStore(null);
      await renderFlushConsumer();

      vi.useFakeTimers();
      act(() => screen.getByTestId("update-font").click());
      expect(set).not.toHaveBeenCalled();

      await act(async () => {
        screen.getByTestId("flush").click();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(set).toHaveBeenCalledTimes(1);
      expect(set).toHaveBeenCalledWith(
        "settings",
        expect.objectContaining({
          appearance: expect.objectContaining({ fontSize: 21 }),
        }),
      );
      expect(save).toHaveBeenCalled();
      expect(screen.getByTestId("flush-result").textContent).toBe("true");

      // The debounce timer was cleared, so nothing writes a second time.
      await act(async () => {
        vi.advanceTimersByTime(500);
        await Promise.resolve();
      });
      expect(set).toHaveBeenCalledTimes(1);
    });

    it("coalesces rapid updates into one write of the latest value", async () => {
      const { set } = mockStore(null);
      await renderFlushConsumer();

      vi.useFakeTimers();
      act(() => screen.getByTestId("update-font").click());
      act(() => screen.getByTestId("update-font-again").click());

      await act(async () => {
        screen.getByTestId("flush").click();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(set).toHaveBeenCalledTimes(1);
      expect(set).toHaveBeenCalledWith(
        "settings",
        expect.objectContaining({
          appearance: expect.objectContaining({ fontSize: 22 }),
        }),
      );
    });

    it("reports a failed write", async () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockStore(null, { setRejects: true });
      await renderFlushConsumer();

      vi.useFakeTimers();
      act(() => screen.getByTestId("update-font").click());

      await act(async () => {
        screen.getByTestId("flush").click();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.getByTestId("flush-result").textContent).toBe("false");
      expect(errSpy).toHaveBeenCalledWith("Failed to save settings:", expect.any(Error));
      errSpy.mockRestore();
    });

    it("is a no-op without a pending update", async () => {
      const { set, save } = mockStore(null);
      await renderFlushConsumer();

      await act(async () => {
        screen.getByTestId("flush").click();
        await Promise.resolve();
      });

      expect(screen.getByTestId("flush-result").textContent).toBe("true");
      expect(set).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
    });

    it("writes a pending update on unmount instead of abandoning it", async () => {
      const { set } = mockStore(null);
      const { unmount } = await renderFlushConsumer();

      vi.useFakeTimers();
      act(() => screen.getByTestId("update-font").click());
      expect(set).not.toHaveBeenCalled();

      await act(async () => {
        unmount();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(set).toHaveBeenCalledWith(
        "settings",
        expect.objectContaining({
          appearance: expect.objectContaining({ fontSize: 21 }),
        }),
      );
    });
  });

  describe("API key secret handling", () => {
    afterEach(() => {
      vi.useRealTimers();
      vi.mocked(invoke).mockReset();
    });

    // Stateful keychain fake keyed by provider: secret_set records,
    // secret_get reads back (names are ai-api-key-<provider>).
    function mockKeychain(initial: Record<string, string> = {}) {
      const stored: Record<string, string> = { ...initial };
      vi.mocked(invoke).mockImplementation(async (cmd, args) => {
        const a = args as { name: string; value?: string };
        const provider = a.name.replace("ai-api-key-", "");
        if (cmd === "secret_set") {
          if (a.value) stored[provider] = a.value;
          else delete stored[provider];
          return undefined;
        }
        if (cmd === "secret_get") return stored[provider] ?? null;
        return undefined;
      });
      return stored;
    }

    it("loads stored keys from the keychain into memory", async () => {
      mockStore(null);
      mockKeychain({ claude: "sk-stored" });

      render(
        <SettingsProvider>
          <TestConsumer />
        </SettingsProvider>,
      );
      await waitFor(() => {
        expect(screen.getByTestId("loaded").textContent).toBe("true");
      });

      expect(screen.getByTestId("claude-key").textContent).toBe("sk-stored");
    });

    it("migrates legacy plaintext keys to the keychain and strips the store copy", async () => {
      const { set } = mockStore({ ai: { apiKeys: { claude: "sk-legacy" } } });
      const stored = mockKeychain();

      render(
        <SettingsProvider>
          <TestConsumer />
        </SettingsProvider>,
      );
      await waitFor(() => {
        expect(screen.getByTestId("loaded").textContent).toBe("true");
      });

      // The plaintext key moved into the keychain and stayed usable in memory.
      expect(stored.claude).toBe("sk-legacy");
      expect(screen.getByTestId("claude-key").textContent).toBe("sk-legacy");
      // The store was rewritten without the plaintext copy.
      expect(set).toHaveBeenCalledWith(
        "settings",
        expect.objectContaining({ ai: expect.objectContaining({ apiKeys: {} }) }),
      );
    });

    it("keeps the key in memory and the store untouched when migration fails", async () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { set } = mockStore({ ai: { apiKeys: { claude: "sk-legacy" } } });
      vi.mocked(invoke).mockImplementation(async (cmd) => {
        if (cmd === "secret_set") throw new Error("keyring locked");
        if (cmd === "secret_get") return null;
        return undefined;
      });

      render(
        <SettingsProvider>
          <TestConsumer />
        </SettingsProvider>,
      );
      await waitFor(() => {
        expect(screen.getByTestId("loaded").textContent).toBe("true");
      });

      // The only copy of the key is preserved for the session and on disk.
      expect(screen.getByTestId("claude-key").textContent).toBe("sk-legacy");
      expect(set).not.toHaveBeenCalled();
      expect(errSpy).toHaveBeenCalled();
      errSpy.mockRestore();
    });

    it("logs when removing the migrated plaintext copy from the store fails", async () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockStore({ ai: { apiKeys: { claude: "sk-legacy" } } }, { setRejects: true });
      mockKeychain();

      render(
        <SettingsProvider>
          <TestConsumer />
        </SettingsProvider>,
      );
      await waitFor(() => {
        expect(screen.getByTestId("loaded").textContent).toBe("true");
      });

      expect(errSpy).toHaveBeenCalledWith(
        "Failed to remove migrated API keys from settings.json:",
        expect.any(Error),
      );
      errSpy.mockRestore();
    });

    it("logs when clearing a keychain entry on reset fails", async () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockStore(null);
      vi.mocked(invoke).mockImplementation(async (cmd) => {
        if (cmd === "secret_set") throw new Error("keyring locked");
        return null;
      });

      render(
        <SettingsProvider>
          <TestConsumer />
        </SettingsProvider>,
      );
      await waitFor(() => {
        expect(screen.getByTestId("loaded").textContent).toBe("true");
      });

      act(() => screen.getByTestId("reset").click());

      await waitFor(() => {
        expect(errSpy).toHaveBeenCalledWith(
          expect.stringContaining("Failed to clear the"),
          expect.any(Error),
        );
      });
      errSpy.mockRestore();
    });

    it("strips API keys from every persisted settings write", async () => {
      const { set } = mockStore(null);
      mockKeychain();

      render(
        <SettingsProvider>
          <UpdateConsumer updates={[["ai.apiKeys", { claude: "sk-typed" }]]} />
        </SettingsProvider>,
      );
      await waitFor(() => {
        expect(screen.getByTestId("loaded").textContent).toBe("true");
      });

      vi.useFakeTimers();
      act(() => screen.getByTestId("update-0").click());
      await act(async () => {
        vi.advanceTimersByTime(500);
        await Promise.resolve();
      });

      expect(set).toHaveBeenCalledWith(
        "settings",
        expect.objectContaining({ ai: expect.objectContaining({ apiKeys: {} }) }),
      );
    });

    it("clears keychain entries on reset", async () => {
      mockStore(null);
      const stored = mockKeychain({ claude: "sk-a", openai: "sk-b" });

      render(
        <SettingsProvider>
          <TestConsumer />
        </SettingsProvider>,
      );
      await waitFor(() => {
        expect(screen.getByTestId("loaded").textContent).toBe("true");
      });

      act(() => screen.getByTestId("reset").click());

      await waitFor(() => {
        expect(stored).toEqual({});
      });
    });
  });
});
