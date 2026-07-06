import { useCallback, useEffect, useState } from "react";
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

  useEffect(() => {
    setFilesVisible(filesVisibleSetting);
  }, [filesVisibleSetting]);
  useEffect(() => {
    setOutlineVisible(outlineVisibleSetting);
  }, [outlineVisibleSetting]);

  // The settings write must stay OUT of the setState updater: React runs
  // updaters during render (and re-runs them if the render restarts), so a
  // side effect there updates SettingsProvider mid-render and can cascade
  // into an update-depth loop.
  const toggleFiles = useCallback(() => {
    const next = !filesVisible;
    setFilesVisible(next);
    updateSettings("layout.filesSidebarVisible", next);
  }, [filesVisible, updateSettings]);

  const toggleOutline = useCallback(() => {
    const next = !outlineVisible;
    setOutlineVisible(next);
    updateSettings("layout.outlineSidebarVisible", next);
  }, [outlineVisible, updateSettings]);

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

  const resetLayout = useCallback(() => {
    updateSettings("layout.filesSidebarVisible", true);
    updateSettings("layout.outlineSidebarVisible", true);
    updateSettings("layout.sidebarLayout", "beside" satisfies Settings["layout"]["sidebarLayout"]);
    updateSettings("layout.swapSidebarSides", false);
    updateSettings("layout.filesSidebarWidth", SIDEBAR_WIDTH_DEFAULT);
    updateSettings("layout.outlineSidebarWidth", SIDEBAR_WIDTH_DEFAULT);
    updateSettings("layout.aiPanelWidth", AI_PANEL_WIDTH_DEFAULT);
    updateSettings("layout.backlinksHeight", null);
  }, [updateSettings]);

  return {
    filesVisible,
    outlineVisible,
    toggleFiles,
    toggleOutline,
    setFilesSidebarWidth,
    setOutlineSidebarWidth,
    setBacklinksHeight,
    resetLayout,
  };
}
