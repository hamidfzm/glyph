import { load } from "@tauri-apps/plugin-store";
import { act, render, screen, waitFor } from "@testing-library/react";
import { useContext } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../lib/settings";
import {
  deepMerge,
  isSafePlainObject,
  SettingsContext,
  SettingsProvider,
  setNestedValue,
} from "./SettingsContext";

const mockedLoad = vi.mocked(load);
const realMatchMedia = window.matchMedia;

// Builds a fake store whose `get` resolves the given saved value, registered as
// the next `load()` result. Returns the `set` spy so tests can assert persisted
// writes.
function mockStore(saved: unknown, { setRejects = false } = {}) {
  const set = vi.fn(() =>
    setRejects ? Promise.reject(new Error("disk full")) : Promise.resolve(),
  );
  const get = vi.fn(() => Promise.resolve(saved));
  mockedLoad.mockResolvedValueOnce({ get, set } as unknown as Awaited<ReturnType<typeof load>>);
  return { get, set };
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
});

describe("isSafePlainObject", () => {
  it("accepts plain object literals", () => {
    expect(isSafePlainObject({})).toBe(true);
    expect(isSafePlainObject({ a: 1 })).toBe(true);
  });

  it("accepts null-prototype objects", () => {
    expect(isSafePlainObject(Object.create(null))).toBe(true);
  });

  it("rejects null, primitives, and arrays", () => {
    expect(isSafePlainObject(null)).toBe(false);
    expect(isSafePlainObject(undefined)).toBe(false);
    expect(isSafePlainObject(42)).toBe(false);
    expect(isSafePlainObject("str")).toBe(false);
    expect(isSafePlainObject([])).toBe(false);
  });

  it("rejects Object.prototype itself", () => {
    expect(isSafePlainObject(Object.prototype)).toBe(false);
  });

  it("rejects class instances (custom prototype)", () => {
    class Foo {}
    expect(isSafePlainObject(new Foo())).toBe(false);
  });
});

describe("deepMerge", () => {
  it("overlays source scalars onto target", () => {
    expect(deepMerge({ a: 1, b: 2 }, { b: 3 })).toEqual({ a: 1, b: 3 });
  });

  it("recurses into nested plain objects", () => {
    expect(deepMerge({ a: { x: 1, y: 2 } }, { a: { y: 9 } })).toEqual({ a: { x: 1, y: 9 } });
  });

  it("replaces (does not merge) when types differ", () => {
    expect(deepMerge({ a: { x: 1 } }, { a: "scalar" })).toEqual({ a: "scalar" });
  });

  it("skips forbidden own keys on the source", () => {
    // Computed key creates an own enumerable "__proto__" property rather than
    // setting the prototype, so deepMerge must explicitly skip it.
    const malicious = { ["__proto__"]: { polluted: true }, safe: 1 };
    const result = deepMerge({ safe: 0 }, malicious);
    expect(result.safe).toBe(1);
    // biome-ignore lint/suspicious/noExplicitAny: probing the prototype chain
    expect(({} as any).polluted).toBeUndefined();
    expect(Object.hasOwn(result, "polluted")).toBe(false);
  });
});

describe("setNestedValue", () => {
  const base = () => structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>;

  it("sets a one-level value, returning a new object", () => {
    const obj = base();
    const result = setNestedValue(obj, "appearance", { theme: "dark" });
    expect(result).not.toBe(obj);
    expect(result.appearance).toEqual({ theme: "dark" });
  });

  it("sets a nested value without mutating the input", () => {
    const obj = base();
    const result = setNestedValue(obj, "appearance.theme", "dark");
    expect((result.appearance as Record<string, unknown>).theme).toBe("dark");
    expect((obj.appearance as Record<string, unknown>).theme).toBe("system");
  });

  it("returns the input unchanged for an empty path or empty segment", () => {
    const obj = base();
    expect(setNestedValue(obj, "", true)).toBe(obj);
    expect(setNestedValue(obj, "appearance..theme", true)).toBe(obj);
  });

  it("rejects a forbidden intermediate key", () => {
    const obj = base();
    expect(setNestedValue(obj, "__proto__.polluted", true)).toBe(obj);
  });

  it("rejects a forbidden final key", () => {
    const obj = base();
    expect(setNestedValue(obj, "appearance.__proto__", true)).toBe(obj);
  });

  it("rejects an unknown top-level key", () => {
    const obj = base();
    expect(setNestedValue(obj, "bogus.x", true)).toBe(obj);
  });

  it("rejects an unknown nested key", () => {
    const obj = base();
    expect(setNestedValue(obj, "appearance.bogus", true)).toBe(obj);
  });

  it("rejects descending through a scalar schema node", () => {
    // fontSize is a number in the schema, so "appearance.fontSize.x" must stop.
    const obj = base();
    expect(setNestedValue(obj, "appearance.fontSize.x", 1)).toBe(obj);
  });

  it("rebuilds intermediates when the current node is not a plain object", () => {
    // Simulates a malformed persisted state where `ai` was replaced by a scalar.
    // The allowlist still permits ai.apiKeys; the writer rebuilds the missing
    // objects rather than reading through the scalar.
    const obj = { ...base(), ai: "broken" } as Record<string, unknown>;
    const result = setNestedValue(obj, "ai.apiKeys", { k: "v" });
    expect(result.ai).toEqual({ apiKeys: { k: "v" } });
  });

  it("rebuilds a missing intermediate then rejects at an empty-schema leaf", () => {
    // `ai` is a scalar (rebuilt to {}) and `apiKeys` is therefore absent on the
    // rebuilt node; descent continues but the empty apiKeys schema has no `foo`
    // key, so the write is rejected and the original object is returned intact.
    const obj = { ...base(), ai: "broken" } as Record<string, unknown>;
    expect(setNestedValue(obj, "ai.apiKeys.foo", "v")).toBe(obj);
  });
});
