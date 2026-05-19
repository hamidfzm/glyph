import { useCallback, useEffect, useState } from "react";
import type { Settings } from "@/lib/settings";

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

  const toggleFiles = useCallback(() => {
    setFilesVisible((v) => {
      updateSettings("layout.filesSidebarVisible", !v);
      return !v;
    });
  }, [updateSettings]);

  const toggleOutline = useCallback(() => {
    setOutlineVisible((v) => {
      updateSettings("layout.outlineSidebarVisible", !v);
      return !v;
    });
  }, [updateSettings]);

  const resetLayout = useCallback(() => {
    updateSettings("layout.filesSidebarVisible", true);
    updateSettings("layout.outlineSidebarVisible", true);
    updateSettings("layout.sidebarLayout", "beside" satisfies Settings["layout"]["sidebarLayout"]);
    updateSettings("layout.swapSidebarSides", false);
  }, [updateSettings]);

  return { filesVisible, outlineVisible, toggleFiles, toggleOutline, resetLayout };
}
