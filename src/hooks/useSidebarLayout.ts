import { useCallback, useEffect, useRef, useState } from "react";
import { useCanSplit } from "@/hooks/useMediaQuery";
import {
  registerSessionSidebarBridge,
  type SessionSidebarBridge,
  sessionSidebarBridge,
} from "@/lib/sessionUiBridge";
import { AI_PANEL_WIDTH_DEFAULT, type Settings, SIDEBAR_WIDTH_DEFAULT } from "@/lib/settings";

interface UseSidebarLayoutOptions {
  filesVisibleSetting: boolean;
  outlineVisibleSetting: boolean;
  updateSettings: (key: string, value: unknown) => void;
}

// Mirrors sidebar visibility from settings into local state so toggles are
// responsive while the persisted setting catches up. resetLayout puts both
// panels back to defaults; menu "Reset View" calls it.
export function useSidebarLayout({
  filesVisibleSetting,
  outlineVisibleSetting,
  updateSettings,
}: UseSidebarLayoutOptions) {
  const [filesVisible, setFilesVisible] = useState(filesVisibleSetting);
  const [outlineVisible, setOutlineVisible] = useState(outlineVisibleSetting);
  // On a narrow (phone) viewport the sidebars are drawers overlaying the
  // document, so they default closed and toggle local state instead of the
  // persisted desktop visibility, so resizing back to a wide window restores
  // whatever the user had there.
  const compact = !useCanSplit();
  const [compactFilesOpen, setCompactFilesOpen] = useState(false);
  const [compactOutlineOpen, setCompactOutlineOpen] = useState(false);

  useEffect(() => {
    setFilesVisible(filesVisibleSetting);
  }, [filesVisibleSetting]);
  useEffect(() => {
    setOutlineVisible(outlineVisibleSetting);
  }, [outlineVisibleSetting]);

  // The workspace session snapshot captures and restores the desktop
  // visibility through the module bridge (this hook mounts below
  // TabsProvider). Restore writes the local mirror only, never the global
  // setting; `null` (a snapshot with no sidebar state) resyncs the mirror to
  // the setting so the previous workspace's visibility doesn't leak in.
  const filesVisibleRef = useRef(filesVisible);
  filesVisibleRef.current = filesVisible;
  const outlineVisibleRef = useRef(outlineVisible);
  outlineVisibleRef.current = outlineVisible;
  const filesVisibleSettingRef = useRef(filesVisibleSetting);
  filesVisibleSettingRef.current = filesVisibleSetting;
  const outlineVisibleSettingRef = useRef(outlineVisibleSetting);
  outlineVisibleSettingRef.current = outlineVisibleSetting;
  useEffect(() => {
    const bridge: SessionSidebarBridge = {
      visibility: () => ({
        filesSidebarVisible: filesVisibleRef.current,
        outlineSidebarVisible: outlineVisibleRef.current,
      }),
      applyVisibility: (visibility) => {
        setFilesVisible(visibility?.filesSidebarVisible ?? filesVisibleSettingRef.current);
        setOutlineVisible(visibility?.outlineSidebarVisible ?? outlineVisibleSettingRef.current);
      },
    };
    registerSessionSidebarBridge(bridge);
    return () => {
      if (sessionSidebarBridge() === bridge) registerSessionSidebarBridge(null);
    };
  }, []);

  // The settings write must stay OUT of the setState updater: React runs
  // updaters during render (and re-runs them if the render restarts), so a
  // side effect there updates SettingsProvider mid-render and can cascade
  // into an update-depth loop.
  const toggleFiles = useCallback(() => {
    if (compact) {
      setCompactFilesOpen((v) => !v);
      return;
    }
    const next = !filesVisible;
    setFilesVisible(next);
    updateSettings("layout.filesSidebarVisible", next);
  }, [compact, filesVisible, updateSettings]);

  const toggleOutline = useCallback(() => {
    if (compact) {
      setCompactOutlineOpen((v) => !v);
      return;
    }
    const next = !outlineVisible;
    setOutlineVisible(next);
    updateSettings("layout.outlineSidebarVisible", next);
  }, [compact, outlineVisible, updateSettings]);

  // Mounted compact drawers register an animated dismissal here (see
  // useDrawerGesture), so closing plays the exit spring before the state
  // flips and unmounts them.
  const drawerDismissals = useRef(new Set<(onDone: () => void) => void>()).current;

  const settleCompactPanelsClosed = useCallback(() => {
    setCompactFilesOpen(false);
    setCompactOutlineOpen(false);
  }, []);

  // Dismiss the compact drawers (backdrop tap, or after opening a file):
  // animated when a drawer is mounted, immediate otherwise.
  const closeCompactPanels = useCallback(() => {
    if (drawerDismissals.size === 0) {
      settleCompactPanelsClosed();
      return;
    }
    for (const dismiss of [...drawerDismissals]) dismiss(settleCompactPanelsClosed);
  }, [drawerDismissals, settleCompactPanelsClosed]);

  const setFilesSidebarWidth = useCallback(
    (width: number) => updateSettings("layout.filesSidebarWidth", width),
    [updateSettings],
  );

  const setOutlineSidebarWidth = useCallback(
    (width: number) => updateSettings("layout.outlineSidebarWidth", width),
    [updateSettings],
  );

  const setBacklinksHeight = useCallback(
    (height: number | null) => updateSettings("layout.backlinksHeight", height),
    [updateSettings],
  );

  const setTagsHeight = useCallback(
    (height: number | null) => updateSettings("layout.tagsHeight", height),
    [updateSettings],
  );

  const setBacklinksCollapsed = useCallback(
    (collapsed: boolean) => updateSettings("layout.backlinksCollapsed", collapsed),
    [updateSettings],
  );

  const setTagsCollapsed = useCallback(
    (collapsed: boolean) => updateSettings("layout.tagsCollapsed", collapsed),
    [updateSettings],
  );

  const resetLayout = useCallback(() => {
    updateSettings("layout.filesSidebarVisible", true);
    updateSettings("layout.outlineSidebarVisible", true);
    updateSettings("layout.sidebarLayout", "beside" satisfies Settings["layout"]["sidebarLayout"]);
    updateSettings("layout.swapSidebarSides", false);
    updateSettings("layout.filesSidebarWidth", SIDEBAR_WIDTH_DEFAULT);
    updateSettings("layout.outlineSidebarWidth", SIDEBAR_WIDTH_DEFAULT);
    updateSettings("layout.aiPanelWidth", AI_PANEL_WIDTH_DEFAULT);
    updateSettings("layout.backlinksHeight", null);
    updateSettings("layout.tagsHeight", null);
    updateSettings("layout.backlinksCollapsed", false);
    updateSettings("layout.tagsCollapsed", false);
  }, [updateSettings]);

  return {
    filesVisible: compact ? compactFilesOpen : filesVisible,
    outlineVisible: compact ? compactOutlineOpen : outlineVisible,
    // Phone drawers overlay the document instead of pushing it; consumers use
    // this to switch the panel to an overlay and show a dismiss backdrop.
    compact,
    closeCompactPanels,
    drawerDismissals,
    toggleFiles,
    toggleOutline,
    setFilesSidebarWidth,
    setOutlineSidebarWidth,
    setBacklinksHeight,
    setTagsHeight,
    setBacklinksCollapsed,
    setTagsCollapsed,
    resetLayout,
  };
}
