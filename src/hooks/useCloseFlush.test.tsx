import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { SettingsContext } from "@/contexts/SettingsContext";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { useCloseFlush } from "./useCloseFlush";

function settingsWrapper(flushSettings: () => Promise<boolean>) {
  return ({ children }: { children: ReactNode }) => (
    <SettingsContext
      value={{
        settings: DEFAULT_SETTINGS,
        updateSettings: () => {},
        resetSettings: () => {},
        flushSettings,
        loaded: true,
      }}
    >
      {children}
    </SettingsContext>
  );
}

describe("useCloseFlush", () => {
  it("flushes settings before documents and returns the document result", async () => {
    const order: string[] = [];
    const flushSettings = vi.fn(async () => {
      order.push("settings");
      return true;
    });
    const flushDocuments = vi.fn(async () => {
      order.push("documents");
      return false;
    });

    const { result } = renderHook(() => useCloseFlush(flushDocuments), {
      wrapper: settingsWrapper(flushSettings),
    });

    await expect(result.current()).resolves.toBe(false);
    expect(order).toEqual(["settings", "documents"]);
  });

  it("does not block the close when the settings flush fails", async () => {
    const flushSettings = vi.fn(async () => false);
    const flushDocuments = vi.fn(async () => true);

    const { result } = renderHook(() => useCloseFlush(flushDocuments), {
      wrapper: settingsWrapper(flushSettings),
    });

    await expect(result.current()).resolves.toBe(true);
    expect(flushDocuments).toHaveBeenCalled();
  });
});
