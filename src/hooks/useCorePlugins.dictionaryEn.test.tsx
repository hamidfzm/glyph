import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsContext, type SettingsContextValue } from "@/contexts/SettingsContext";
import { registerTranslations } from "@/lib/i18n";
import { CORE_PLUGINS } from "@/lib/plugins/corePlugins";
import { createPluginHost } from "@/lib/plugins/host";
import { type CorePluginSettings, DEFAULT_SETTINGS } from "@/lib/settings";
import { clearDictionarySources, listDictionarySources } from "@/lib/spellcheck/dictionarySources";
import { preloadCorePlugins } from "@/test/preloadCorePlugins";
import { useCorePlugins } from "./useCorePlugins";

// The real English dictionary plugin against the real host: English is on the
// spell-check language list only while the plugin is on.

preloadCorePlugins("dictionaryEn");

const ALL_OFF = Object.fromEntries(
  Object.keys(DEFAULT_SETTINGS.corePlugins).map((key) => [key, false]),
) as unknown as CorePluginSettings;

function settingsValue(dictionaryEn: boolean): SettingsContextValue {
  return {
    settings: { ...DEFAULT_SETTINGS, corePlugins: { ...ALL_OFF, dictionaryEn } },
    updateSettings: vi.fn(),
    resetSettings: vi.fn(),
    flushSettings: async () => true,
    loaded: true,
  };
}

function renderCore(initial: SettingsContextValue) {
  const host = createPluginHost(vi.fn(), registerTranslations);
  let value = initial;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
  );
  const view = renderHook(() => useCorePlugins(host, vi.fn()), { wrapper });
  const setSettings = (next: SettingsContextValue) => {
    value = next;
    view.rerender();
  };
  return { ...view, host, setSettings };
}

const languages = () => listDictionarySources().map((d) => `${d.language}: ${d.label}`);

beforeEach(() => clearDictionarySources());
afterEach(() => vi.restoreAllMocks());

describe("English dictionary core plugin lifecycle", () => {
  it("loads none of its code while it is off", async () => {
    const english = CORE_PLUGINS.find((core) => core.settingsKey === "dictionaryEn");
    if (!english) throw new Error("English dictionary core plugin missing");
    const load = vi.spyOn(english, "load");
    const { result } = renderCore(settingsValue(false));

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(load).not.toHaveBeenCalled();
    expect(languages()).toEqual([]);
  });

  it("offers English, on by default", async () => {
    expect(DEFAULT_SETTINGS.corePlugins.dictionaryEn).toBe(true);
    renderCore(settingsValue(true));
    await waitFor(() => expect(languages()).toEqual(["en: English (US)"]));
  });

  it("follows its toggle at runtime, with no restart", async () => {
    const { host, setSettings } = renderCore(settingsValue(true));
    await waitFor(() => expect(languages()).toEqual(["en: English (US)"]));

    act(() => setSettings(settingsValue(false)));
    expect(languages()).toEqual([]);
    expect(host.listLoaded()).toEqual([]);

    act(() => setSettings(settingsValue(true)));
    await waitFor(() => expect(languages()).toEqual(["en: English (US)"]));
  });
});
