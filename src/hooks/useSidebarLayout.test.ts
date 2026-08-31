import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerSessionSidebarBridge, sessionSidebarBridge } from "@/lib/sessionUiBridge";
import { useSidebarLayout } from "./useSidebarLayout";

describe("useSidebarLayout", () => {
  it("mirrors the initial settings into local state", () => {
    const { result } = renderHook(() =>
      useSidebarLayout({
        filesVisibleSetting: false,
        outlineVisibleSetting: true,
        updateSettings: vi.fn(),
      }),
    );
    expect(result.current.filesVisible).toBe(false);
    expect(result.current.outlineVisible).toBe(true);
  });

  it("re-syncs when the persisted setting changes externally", () => {
    const { result, rerender } = renderHook(
      (props: { filesVisibleSetting: boolean; outlineVisibleSetting: boolean }) =>
        useSidebarLayout({ ...props, updateSettings: vi.fn() }),
      { initialProps: { filesVisibleSetting: true, outlineVisibleSetting: true } },
    );
    rerender({ filesVisibleSetting: false, outlineVisibleSetting: true });
    expect(result.current.filesVisible).toBe(false);
  });

  it("toggleFiles flips local state and persists the new value", () => {
    const updateSettings = vi.fn();
    const { result } = renderHook(() =>
      useSidebarLayout({
        filesVisibleSetting: true,
        outlineVisibleSetting: true,
        updateSettings,
      }),
    );
    act(() => {
      result.current.toggleFiles();
    });
    expect(result.current.filesVisible).toBe(false);
    expect(updateSettings).toHaveBeenCalledWith("layout.filesSidebarVisible", false);
  });

  it("toggleOutline flips local state and persists the new value", () => {
    const updateSettings = vi.fn();
    const { result } = renderHook(() =>
      useSidebarLayout({
        filesVisibleSetting: true,
        outlineVisibleSetting: true,
        updateSettings,
      }),
    );
    act(() => {
      result.current.toggleOutline();
    });
    expect(result.current.outlineVisible).toBe(false);
    expect(updateSettings).toHaveBeenCalledWith("layout.outlineSidebarVisible", false);
  });

  it("persists panel sizes through the width and backlinks setters", () => {
    const updateSettings = vi.fn();
    const { result } = renderHook(() =>
      useSidebarLayout({
        filesVisibleSetting: true,
        outlineVisibleSetting: true,
        updateSettings,
      }),
    );
    act(() => {
      result.current.setFilesSidebarWidth(300);
      result.current.setOutlineSidebarWidth(280);
      result.current.setBacklinksHeight(150);
      result.current.setTagsHeight(120);
      result.current.setBacklinksCollapsed(true);
      result.current.setTagsCollapsed(true);
      result.current.setBacklinksHeight(null);
    });
    expect(updateSettings).toHaveBeenCalledWith("layout.tagsHeight", 120);
    expect(updateSettings).toHaveBeenCalledWith("layout.backlinksCollapsed", true);
    expect(updateSettings).toHaveBeenCalledWith("layout.tagsCollapsed", true);
    expect(updateSettings).toHaveBeenCalledWith("layout.filesSidebarWidth", 300);
    expect(updateSettings).toHaveBeenCalledWith("layout.outlineSidebarWidth", 280);
    expect(updateSettings).toHaveBeenCalledWith("layout.backlinksHeight", 150);
    expect(updateSettings).toHaveBeenLastCalledWith("layout.backlinksHeight", null);
  });

  it("resetLayout writes every layout default, sizes included", () => {
    const updateSettings = vi.fn();
    const { result } = renderHook(() =>
      useSidebarLayout({
        filesVisibleSetting: false,
        outlineVisibleSetting: false,
        updateSettings,
      }),
    );
    act(() => {
      result.current.resetLayout();
    });
    expect(updateSettings).toHaveBeenCalledWith("layout.filesSidebarVisible", true);
    expect(updateSettings).toHaveBeenCalledWith("layout.outlineSidebarVisible", true);
    expect(updateSettings).toHaveBeenCalledWith("layout.sidebarLayout", "beside");
    expect(updateSettings).toHaveBeenCalledWith("layout.swapSidebarSides", false);
    expect(updateSettings).toHaveBeenCalledWith("layout.filesSidebarWidth", 224);
    expect(updateSettings).toHaveBeenCalledWith("layout.outlineSidebarWidth", 224);
    expect(updateSettings).toHaveBeenCalledWith("layout.aiPanelWidth", 340);
    expect(updateSettings).toHaveBeenCalledWith("layout.backlinksHeight", null);
    expect(updateSettings).toHaveBeenCalledWith("layout.tagsHeight", null);
    expect(updateSettings).toHaveBeenCalledWith("layout.backlinksCollapsed", false);
    expect(updateSettings).toHaveBeenCalledWith("layout.tagsCollapsed", false);
  });

  it("serves capture and restore through the session bridge without touching settings", () => {
    const updateSettings = vi.fn();
    const { result, unmount } = renderHook(() =>
      useSidebarLayout({
        filesVisibleSetting: true,
        outlineVisibleSetting: true,
        updateSettings,
      }),
    );

    expect(sessionSidebarBridge()?.visibility()).toEqual({
      filesSidebarVisible: true,
      outlineSidebarVisible: true,
    });

    // Restore applies the snapshot to the local mirror only.
    act(() => {
      sessionSidebarBridge()?.applyVisibility({
        filesSidebarVisible: false,
        outlineSidebarVisible: false,
      });
    });
    expect(result.current.filesVisible).toBe(false);
    expect(result.current.outlineVisible).toBe(false);
    expect(updateSettings).not.toHaveBeenCalled();
    expect(sessionSidebarBridge()?.visibility()).toEqual({
      filesSidebarVisible: false,
      outlineSidebarVisible: false,
    });

    // A null apply resyncs the mirror to the persisted setting.
    act(() => {
      sessionSidebarBridge()?.applyVisibility(null);
    });
    expect(result.current.filesVisible).toBe(true);
    expect(result.current.outlineVisible).toBe(true);

    // A replacement registered before this hook unmounts (a remount) must
    // survive the old instance's cleanup.
    const replacement = {
      visibility: () => ({ filesSidebarVisible: true, outlineSidebarVisible: true }),
      applyVisibility: () => {},
    };
    registerSessionSidebarBridge(replacement);
    unmount();
    expect(sessionSidebarBridge()).toBe(replacement);
    registerSessionSidebarBridge(null);
  });
});

describe("useSidebarLayout on a compact viewport", () => {
  const originalMatchMedia = window.matchMedia;

  // Compact is "the tablet query does not match", so the panels behave as
  // drawers: closed by default and toggled without touching the settings.
  beforeEach(() => {
    window.matchMedia = vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  const renderCompact = (updateSettings = vi.fn()) =>
    renderHook(() =>
      useSidebarLayout({
        filesVisibleSetting: true,
        outlineVisibleSetting: true,
        updateSettings,
      }),
    );

  it("starts with both drawers closed even when the settings say visible", () => {
    const { result } = renderCompact();
    expect(result.current.compact).toBe(true);
    expect(result.current.filesVisible).toBe(false);
    expect(result.current.outlineVisible).toBe(false);
  });

  it("toggles the drawers without writing the desktop visibility settings", () => {
    const updateSettings = vi.fn();
    const { result } = renderCompact(updateSettings);

    act(() => {
      result.current.toggleFiles();
    });
    expect(result.current.filesVisible).toBe(true);

    act(() => {
      result.current.toggleOutline();
    });
    expect(result.current.outlineVisible).toBe(true);

    expect(updateSettings).not.toHaveBeenCalledWith("layout.filesSidebarVisible", true);
    expect(updateSettings).not.toHaveBeenCalledWith("layout.outlineSidebarVisible", true);
  });

  it("closeCompactPanels dismisses both drawers", () => {
    const { result } = renderCompact();
    act(() => {
      result.current.toggleFiles();
      result.current.toggleOutline();
    });

    act(() => {
      result.current.closeCompactPanels();
    });
    expect(result.current.filesVisible).toBe(false);
    expect(result.current.outlineVisible).toBe(false);
  });

  it("defers the close to a registered drawer dismissal until it settles", () => {
    const { result } = renderCompact();
    act(() => {
      result.current.toggleFiles();
    });

    let settle: (() => void) | undefined;
    const dismiss = vi.fn((onDone: () => void) => {
      settle = onDone;
    });
    result.current.drawerDismissals.add(dismiss);

    act(() => {
      result.current.closeCompactPanels();
    });
    expect(dismiss).toHaveBeenCalledOnce();
    // The drawer stays mounted while its exit spring plays.
    expect(result.current.filesVisible).toBe(true);

    act(() => {
      settle?.();
    });
    expect(result.current.filesVisible).toBe(false);
  });
});
