import { type ReactNode, useMemo } from "react";
import { useSettings } from "@/hooks/useSettings";
import { useSidebarLayout } from "@/hooks/useSidebarLayout";
import { SidebarLayoutContext, type SidebarLayoutContextValue } from "./SidebarLayoutContext";

export function SidebarLayoutProvider({ children }: { children: ReactNode }) {
  const { settings, updateSettings } = useSettings();
  const layout = useSidebarLayout({
    filesVisibleSetting: settings.layout.filesSidebarVisible,
    outlineVisibleSetting: settings.layout.outlineSidebarVisible,
    updateSettings,
  });

  const value = useMemo<SidebarLayoutContextValue>(
    () => ({
      ...layout,
      sidebarLayout: settings.layout.sidebarLayout,
      swapSidebarSides: settings.layout.swapSidebarSides,
      filesSidebarWidth: settings.layout.filesSidebarWidth,
      outlineSidebarWidth: settings.layout.outlineSidebarWidth,
    }),
    [
      layout,
      settings.layout.sidebarLayout,
      settings.layout.swapSidebarSides,
      settings.layout.filesSidebarWidth,
      settings.layout.outlineSidebarWidth,
    ],
  );

  return <SidebarLayoutContext.Provider value={value}>{children}</SidebarLayoutContext.Provider>;
}
