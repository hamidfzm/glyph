import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useAppModals } from "./useAppModals";

describe("useAppModals", () => {
  it("starts with every modal closed", () => {
    const { result } = renderHook(() => useAppModals());
    expect(result.current.settingsOpen).toBe(false);
    expect(result.current.workspaceSettingsTab).toBeNull();
  });

  it.each([
    { opener: "openSettings", tab: "appearance" },
    { opener: "openPlugins", tab: "plugins" },
  ] as const)("$opener opens Settings on the $tab tab", ({ opener, tab }) => {
    // Plugin management lives in Settings, so both commands open the one
    // modal and differ only in which tab it lands on.
    const { result } = renderHook(() => useAppModals());

    act(() => result.current[opener]());
    expect(result.current.settingsOpen).toBe(true);
    expect(result.current.settingsTab).toBe(tab);
    expect(result.current.workspaceSettingsTab).toBeNull();

    act(() => result.current.closeSettings());
    expect(result.current.settingsOpen).toBe(false);
    // The tab outlives the close so the exit spring keeps showing it.
    expect(result.current.settingsTab).toBe(tab);
  });

  it("reopens Settings on the last tab rather than resetting it", () => {
    const { result } = renderHook(() => useAppModals());
    act(() => result.current.openPlugins());
    act(() => result.current.closeSettings());
    act(() => result.current.openSettings());
    expect(result.current.settingsTab).toBe("plugins");
  });

  it("marks whichever settings modal opened last as on top", () => {
    const { result } = renderHook(() => useAppModals());
    act(() => result.current.openWorkspaceSettings());
    expect(result.current.settingsOnTop).toBe(false);
    act(() => result.current.openPlugins());
    expect(result.current.settingsOnTop).toBe(true);
    act(() => result.current.openSyncSettings());
    expect(result.current.settingsOnTop).toBe(false);
    act(() => result.current.openSettings());
    expect(result.current.settingsOnTop).toBe(true);
  });

  it("moves open Settings to the Plugins tab without reopening it", () => {
    const { result } = renderHook(() => useAppModals());
    act(() => result.current.openSettings());
    act(() => result.current.setSettingsTab("privacy"));
    act(() => result.current.openPlugins());
    expect(result.current.settingsOpen).toBe(true);
    expect(result.current.settingsTab).toBe("plugins");
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
    expect(result.current.settingsOpen).toBe(false);

    act(() => result.current.closeWorkspaceSettings());
    expect(result.current.workspaceSettingsTab).toBeNull();
  });

  it("moves the open modal to another tab without reopening it", () => {
    const { result } = renderHook(() => useAppModals());
    act(() => result.current.openWorkspaceSettings());
    act(() => result.current.openSyncSettings());
    expect(result.current.workspaceSettingsTab).toBe("sync");
  });

  it("keeps the openers stable across renders so the action bus is not rebuilt", () => {
    const { result, rerender } = renderHook(() => useAppModals());
    const first = result.current.openSettings;
    act(() => result.current.openPlugins());
    rerender();
    expect(result.current.openSettings).toBe(first);
  });
});
