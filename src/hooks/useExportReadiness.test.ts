import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PluginsContext, type PluginsContextValue } from "@/contexts/PluginsContext";
import { createRegistry } from "@/lib/plugins/registry";
import { CLI_PLUGIN_WAIT_MS, useExportReadiness } from "./useExportReadiness";

// No SettingsProvider in these renders, so the flag is controlled directly.
const settings = { loaded: true };
vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => settings,
}));

// Only the fields the gate reads; the full provider surface is irrelevant.
function pluginsStub(initialLoadDone: boolean): PluginsContextValue {
  return { siteThemes: createRegistry(), initialLoadDone } as unknown as PluginsContextValue;
}

function providerWrapper(initialLoadDone: boolean) {
  return ({ children }: { children: ReactNode }) =>
    createElement(PluginsContext.Provider, { value: pluginsStub(initialLoadDone) }, children);
}

beforeEach(() => {
  settings.loaded = true;
  vi.useRealTimers();
});

describe("useExportReadiness", () => {
  it("waits for persisted settings", () => {
    // The print options an export honours live in settings, so rendering
    // before they load would quietly produce a different document.
    settings.loaded = false;
    const { result } = renderHook(() => useExportReadiness());
    expect(result.current.ready).toBe(false);
  });

  it("is ready without a plugin host, which is what tests and a bare app have", () => {
    const { result } = renderHook(() => useExportReadiness());
    expect(result.current.ready).toBe(true);
    expect(result.current.themes).toEqual([]);
  });

  it("waits for the plugin host's startup load", () => {
    const { result } = renderHook(() => useExportReadiness(), {
      wrapper: providerWrapper(false),
    });
    expect(result.current.ready).toBe(false);
  });

  it("is ready once the plugin host has loaded", () => {
    const { result } = renderHook(() => useExportReadiness(), {
      wrapper: providerWrapper(true),
    });
    expect(result.current.ready).toBe(true);
  });

  it("gives up on a plugin host that never finishes", async () => {
    // A hung plugin must not hang a CI job forever: past the wait the render
    // proceeds with whatever registered, and a missing theme fails loudly.
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useExportReadiness(), {
        wrapper: providerWrapper(false),
      });
      expect(result.current.ready).toBe(false);

      // The expiring timer sets state, so the advance must run inside act.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(CLI_PLUGIN_WAIT_MS + 1);
      });

      expect(result.current.ready).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
