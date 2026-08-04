import { load } from "@tauri-apps/plugin-store";
import { useContext, useState } from "react";
import { vi } from "vitest";
import { SettingsContext } from "@/contexts/SettingsContext";

// Shared fixtures for the SettingsProvider suites: a fake persistence store and
// the consumers that drive updateSettings / flushSettings / resetSettings.

/** The mocked plugin-store loader, for tests that stub it directly. */
export const mockedLoad = vi.mocked(load);
/** The jsdom matchMedia, so theme tests can restore it after stubbing. */
export const realMatchMedia = window.matchMedia;

// Builds a fake store whose `get` resolves the given saved value, registered as
// the next `load()` result. Returns the `set` and `save` spies so tests can
// assert persisted writes. With `deferLoad`, `load()` stays pending until the
// returned `resolveLoad` is called.
export function mockStore(saved: unknown, { setRejects = false, deferLoad = false } = {}) {
  const set = vi.fn(() =>
    setRejects ? Promise.reject(new Error("disk full")) : Promise.resolve(),
  );
  const save = vi.fn(() => Promise.resolve());
  const get = vi.fn(() => Promise.resolve(saved));
  const store = { get, set, save } as unknown as Awaited<ReturnType<typeof load>>;
  // Captured when the provider calls load(), so resolveLoad must stay a stable
  // wrapper that reads the latest resolver.
  let resolve: ((store: Awaited<ReturnType<typeof load>>) => void) | undefined;
  if (deferLoad) {
    mockedLoad.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
  } else {
    mockedLoad.mockResolvedValueOnce(store);
  }
  return { get, set, save, resolveLoad: () => resolve?.(store) };
}

// Generic consumer that fires a sequence of updateSettings(path, value) calls,
// one per button, so tests can drive applyTheme / applyCSSVariables branches.
export function UpdateConsumer({ updates }: { updates: Array<[string, unknown]> }) {
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
export function FlushConsumer() {
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

export function TestConsumer({ attack }: { attack?: { path: string; value: unknown } } = {}) {
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

/** Clear the DOM state the provider writes, before each test. */
export function resetSettingsDom(): void {
  document.documentElement.classList.remove("dark");
  document.documentElement.style.cssText = "";
}
