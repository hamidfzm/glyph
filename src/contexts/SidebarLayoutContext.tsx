import { createContext, type ReactNode, useContext, useMemo } from "react";
import { useSidebarLayout } from "@/hooks/useSidebarLayout";
import type { Settings, SidebarLayout } from "@/lib/settings";

type SidebarLayoutApi = ReturnType<typeof useSidebarLayout>;

export interface SidebarLayoutContextValue extends SidebarLayoutApi {
  sidebarLayout: SidebarLayout;
  swapSidebarSides: boolean;
  sidebarWidth: number | undefined;
}

export const SidebarLayoutContext = createContext<SidebarLayoutContextValue | null>(null);

interface SidebarLayoutProviderProps {
  settings: Settings;
  updateSettings: (key: string, value: unknown) => void;
  children: ReactNode;
}

export function SidebarLayoutProvider({
  settings,
  updateSettings,
  children,
}: SidebarLayoutProviderProps) {
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
      sidebarWidth: settings.layout.sidebarWidth,
    }),
    [
      layout,
      settings.layout.sidebarLayout,
      settings.layout.swapSidebarSides,
      settings.layout.sidebarWidth,
    ],
  );

  return <SidebarLayoutContext.Provider value={value}>{children}</SidebarLayoutContext.Provider>;
}

export function useSidebarLayoutContext(): SidebarLayoutContextValue {
  const ctx = useContext(SidebarLayoutContext);
  if (!ctx) throw new Error("useSidebarLayoutContext must be used inside <SidebarLayoutProvider>");
  return ctx;
}
