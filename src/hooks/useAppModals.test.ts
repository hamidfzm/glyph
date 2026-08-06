import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useAppModals } from "./useAppModals";

const MODALS = [
  { open: "openSettings", close: "closeSettings", flag: "settingsOpen" },
  { open: "openPlugins", close: "closePlugins", flag: "pluginsOpen" },
] as const;

describe("useAppModals", () => {
  it("starts with every modal closed", () => {
    const { result } = renderHook(() => useAppModals());
    for (const { flag } of MODALS) {
      expect(result.current[flag]).toBe(false);
    }
    expect(result.current.workspaceSettingsTab).toBeNull();
  });

  it.each([
    { opener: "openWorkspaceSettings", tab: "website" },
    { opener: "openSyncSettings", tab: "sync" },
  ] as const)("$opener opens Workspace Settings on the $tab tab", ({ opener, tab }) => {
    // Cloud sync lives in Workspace Settings, so both menu commands open the
    // one modal and differ only in which tab it lands on.
    const { result } = renderHook(() => useAppModals());

    act(() => result.current[opener]());
    expect(result.current.workspaceSettingsTab).toBe(tab);
    for (const { flag } of MODALS) {
      expect(result.current[flag]).toBe(false);
    }

    act(() => result.current.closeWorkspaceSettings());
    expect(result.current.workspaceSettingsTab).toBeNull();
  });

  it("moves the open modal to another tab without reopening it", () => {
    const { result } = renderHook(() => useAppModals());
    act(() => result.current.openWorkspaceSettings());
    act(() => result.current.openSyncSettings());
    expect(result.current.workspaceSettingsTab).toBe("sync");
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
