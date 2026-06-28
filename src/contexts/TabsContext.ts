import { createContext, useContext } from "react";
import type { TocEntry } from "@/hooks/useTableOfContents";
import type { useTabs } from "@/hooks/useTabs";
import type { WorkspaceNotice } from "@/hooks/useWorkspaceNotice";
import type { Backlink } from "@/lib/backlinks";

// Context + hooks for the tabs/workspace state. Kept in a component-free module
// so the provider file stays Fast-Refresh-eligible (a file that exports a
// component plus a hook/context bails out of React Fast Refresh). The provider
// lives in `TabsProvider.tsx`.

type TabsApi = ReturnType<typeof useTabs>;

export interface TabsContextValue extends TabsApi {
  // Derived from the active file + edit mode. View mode renders saved content;
  // edit/split renders the in-memory editContent so preview reflects typing.
  displayContent: string | null;
  tocEntries: TocEntry[];
  backlinks: Backlink[];
  // Notice shown for a workspace event (#262): a refusal, or a persistent
  // warning when a folder is opened inside a parent git repo. A translation
  // key + values so the banner re-localizes live (see WorkspaceNoticeBanner).
  workspaceNotice: WorkspaceNotice | null;
  dismissWorkspaceNotice: () => void;
}

export const TabsContext = createContext<TabsContextValue | null>(null);

export function useTabsContext(): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("useTabsContext must be used inside <TabsProvider>");
  return ctx;
}

// The opened workspace folder's root (or undefined when only loose files are
// open), read straight from the tabs context. Uses optional chaining rather
// than useTabsContext so the shared renderers (notebooks, canvas, print, and
// isolated tests) can read it with no provider and simply skip workspace
// resolution.
export function useWorkspaceRoot(): string | undefined {
  return useContext(TabsContext)?.workspace?.root;
}
