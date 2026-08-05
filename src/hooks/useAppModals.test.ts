import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useAppModals } from "./useAppModals";

const MODALS = [
  { open: "openSettings", close: "closeSettings", flag: "settingsOpen" },
  { open: "openSyncSettings", close: "closeSyncSettings", flag: "syncSettingsOpen" },
  { open: "openWorkspaceSettings", close: "closeWorkspaceSettings", flag: "workspaceSettingsOpen" },
  { open: "openPlugins", close: "closePlugins", flag: "pluginsOpen" },
] as const;

describe("useAppModals", () => {
  it("starts with every modal closed", () => {
    const { result } = renderHook(() => useAppModals());
    for (const { flag } of MODALS) {
      expect(result.current[flag]).toBe(false);
    }
  });

  it.each(MODALS)("$open opens and $close closes that modal alone", (modal) => {
    const { result } = renderHook(() => useAppModals());

    act(() => result.current[modal.open]());
    expect(result.current[modal.flag]).toBe(true);
    // Opening one modal must not disturb the others; the shell renders them
    // as siblings, so a shared flag would stack two overlays.
    for (const other of MODALS.filter((m) => m !== modal)) {
      expect(result.current[other.flag]).toBe(false);
    }

    act(() => result.current[modal.close]());
    expect(result.current[modal.flag]).toBe(false);
  });

  it("keeps the openers stable across renders so the action bus is not rebuilt", () => {
    const { result, rerender } = renderHook(() => useAppModals());
    const first = result.current.openSettings;
    act(() => result.current.openPlugins());
    rerender();
    expect(result.current.openSettings).toBe(first);
  });
});
