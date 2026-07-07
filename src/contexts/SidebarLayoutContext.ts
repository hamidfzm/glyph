import { createContext, useContext } from "react";
import type { useSidebarLayout } from "@/hooks/useSidebarLayout";
import type { SidebarLayout } from "@/lib/settings";

// Context + hook for the sidebar layout. Kept in a component-free module so the
// provider file stays Fast-Refresh-eligible (a file that exports a component
// plus a hook/context bails out of React Fast Refresh). The provider lives in
// `SidebarLayoutProvider.tsx`.

type SidebarLayoutApi = ReturnType<typeof useSidebarLayout>;

export interface SidebarLayoutContextValue extends SidebarLayoutApi {
  sidebarLayout: SidebarLayout;
  swapSidebarSides: boolean;
  filesSidebarWidth: number;
  outlineSidebarWidth: number;
  backlinksHeight: number | null;
}

export const SidebarLayoutContext = createContext<SidebarLayoutContextValue | null>(null);

export function useSidebarLayoutContext(): SidebarLayoutContextValue {
  const ctx = useContext(SidebarLayoutContext);
  if (!ctx) throw new Error("useSidebarLayoutContext must be used inside <SidebarLayoutProvider>");
  return ctx;
}
