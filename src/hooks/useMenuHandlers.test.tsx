import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SidebarLayoutContext,
  type SidebarLayoutContextValue,
} from "@/contexts/SidebarLayoutContext";
import { TabsContext, type TabsContextValue } from "@/contexts/TabsContext";
import type { AppModals } from "@/hooks/useAppModals";
import { useMenuHandlers } from "@/hooks/useMenuHandlers";
import { useSettings } from "@/hooks/useSettings";
import type { ShellControllers } from "@/hooks/useShellControllers";
import { DEFAULT_SETTINGS, EDITOR_MODE } from "@/lib/settings";
import { tabsContextValue } from "@/test/fixtures/tabsContext";

function makeModals(): AppModals {
  return {
    settingsOpen: false,
    workspaceSettingsTab: null,
    pluginsOpen: false,
    setWorkspaceSettingsTab: vi.fn(),
    openSettings: vi.fn(),
    closeSettings: vi.fn(),
    openSyncSettings: vi.fn(),
    openWorkspaceSettings: vi.fn(),
    closeWorkspaceSettings: vi.fn(),
    openPlugins: vi.fn(),
    closePlugins: vi.fn(),
  };
}

// The hook reads only a handful of controller fields, so the rest stay absent.
function makeControllers(zoomActions?: ShellControllers["zoomActions"]): ShellControllers {
  return {
    aiController: { runAction: vi.fn(), togglePanel: vi.fn() },
    readAloud: { toggle: vi.fn() },
    printDoc: vi.fn(),
    exporters: {
      exportHtml: vi.fn(),
      exportDocx: vi.fn(),
      exportEpub: vi.fn(),
      exportPdf: vi.fn(),
    },
    siteExporter: { exportWebsite: vi.fn() },
    zoomActions,
  } as unknown as ShellControllers;
}

const updateSettings = vi.fn();

vi.mock("@/hooks/useSettings", () => ({ useSettings: vi.fn() }));

const sidebar: SidebarLayoutContextValue = {
  toggleFiles: vi.fn(),
  toggleOutline: vi.fn(),
  resetLayout: vi.fn(),
} as unknown as SidebarLayoutContextValue;

beforeEach(() => {
  updateSettings.mockClear();
  vi.mocked(useSettings).mockReturnValue({
    settings: DEFAULT_SETTINGS,
    updateSettings,
    resetSettings: vi.fn(),
    flushSettings: vi.fn(),
    loaded: true,
  });
});

function renderHandlers(
  tabs: Partial<TabsContextValue> = {},
  controllers = makeControllers({ zoomIn: vi.fn(), zoomOut: vi.fn(), zoomReset: vi.fn() }),
) {
  const modals = makeModals();
  const value = tabsContextValue(tabs);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TabsContext.Provider value={value}>
      <SidebarLayoutContext.Provider value={sidebar}>{children}</SidebarLayoutContext.Provider>
    </TabsContext.Provider>
  );
  const { result } = renderHook(() => useMenuHandlers({ modals, controllers, onFind: vi.fn() }), {
    wrapper,
  });
  return { handlers: result.current, value, controllers, modals };
}

describe("useMenuHandlers", () => {
  it("saves the active document, and does nothing without one", () => {
    const withTab = renderHandlers({ activeTabId: "tab-1" });
    withTab.handlers.save();
    expect(withTab.value.saveDocument).toHaveBeenCalledWith("tab-1");

    const noTab = renderHandlers();
    noTab.handlers.save();
    expect(noTab.value.saveDocument).not.toHaveBeenCalled();
  });

  it("cycles the active tab's editor mode, and does nothing without one", () => {
    const withTab = renderHandlers({
      activeTabId: "tab-1",
      activeFile: { mode: EDITOR_MODE.view } as TabsContextValue["activeFile"],
    });
    withTab.handlers.toggleEdit();
    expect(withTab.value.setTabMode).toHaveBeenCalledWith("tab-1", EDITOR_MODE.edit);

    const noTab = renderHandlers();
    noTab.handlers.toggleEdit();
    expect(noTab.value.setTabMode).not.toHaveBeenCalled();
  });

  // A graph tab is active but carries no file, so there is no mode to read.
  it("treats a tab with no file as view mode when cycling", () => {
    const { handlers, value } = renderHandlers({ activeTabId: "tab-1", activeFile: null });
    handlers.toggleEdit();
    expect(value.setTabMode).toHaveBeenCalledWith("tab-1", EDITOR_MODE.edit);
  });

  it("toggles autosave to the opposite of the stored setting", () => {
    const { handlers } = renderHandlers();
    handlers.toggleAutoSave();
    // SettingsContext's default has autosave on, so the menu item turns it off.
    expect(updateSettings).toHaveBeenCalledWith("behavior.autoSave", false);
  });

  it("routes the zoom commands to the active surface", () => {
    const zoomActions = { zoomIn: vi.fn(), zoomOut: vi.fn(), zoomReset: vi.fn() };
    const { handlers } = renderHandlers({}, makeControllers(zoomActions));

    handlers.zoomIn();
    handlers.zoomOut();
    handlers.zoomReset();

    expect(zoomActions.zoomIn).toHaveBeenCalled();
    expect(zoomActions.zoomOut).toHaveBeenCalled();
    expect(zoomActions.zoomReset).toHaveBeenCalled();
  });

  // Nothing focused registers a zoom target, so the menu items must be inert
  // rather than throwing on a missing surface.
  it("ignores the zoom commands when no surface is registered", () => {
    const { handlers } = renderHandlers({}, makeControllers(undefined));
    expect(() => {
      handlers.zoomIn();
      handlers.zoomOut();
      handlers.zoomReset();
    }).not.toThrow();
  });

  it("closes the active tab and opens each modal through the shared state", () => {
    const { handlers, value, modals } = renderHandlers({ activeTabId: "tab-1" });

    handlers.closeTab();
    expect(value.closeTab).toHaveBeenCalledWith("tab-1");

    const noTab = renderHandlers();
    noTab.handlers.closeTab();
    expect(noTab.value.closeTab).not.toHaveBeenCalled();

    handlers.openSettings();
    handlers.openSyncSettings();
    handlers.managePlugins();
    handlers.workspaceSettings();
    expect(modals.openSettings).toHaveBeenCalled();
    expect(modals.openSyncSettings).toHaveBeenCalled();
    expect(modals.openPlugins).toHaveBeenCalled();
    expect(modals.openWorkspaceSettings).toHaveBeenCalled();
  });

  it("opens a folder with no argument, so the window manager routes the choice", () => {
    const { handlers, value } = renderHandlers();
    handlers.openFolder();
    expect(value.openFolder).toHaveBeenCalledWith();
  });
});
