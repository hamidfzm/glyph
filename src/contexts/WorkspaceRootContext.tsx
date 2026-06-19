import { createContext, type ReactNode, useContext } from "react";
import { useTabsContext } from "@/contexts/TabsContext";

// The opened workspace folder's root path (or undefined when only loose files
// are open), delivered to the deep render tree without prop-drilling through
// MarkdownViewer / MarkdownContent / CanvasViewer / SplitView. It defaults to
// undefined so the shared renderers (used by notebooks, canvas, print, and
// isolated tests) work with no provider and simply skip workspace-relative
// resolution.
export const WorkspaceRootContext = createContext<string | undefined>(undefined);

/** The opened workspace root, or undefined when no folder workspace is open. */
export function useWorkspaceRoot(): string | undefined {
  return useContext(WorkspaceRootContext);
}

// Derives the root from the tabs context and publishes it. Mounted once below
// TabsProvider so every document and canvas renderer can read it.
export function WorkspaceRootProvider({ children }: { children: ReactNode }) {
  const { workspace } = useTabsContext();
  return (
    <WorkspaceRootContext.Provider value={workspace?.root}>
      {children}
    </WorkspaceRootContext.Provider>
  );
}
