import { createContext, type ReactNode, useContext, useMemo } from "react";
import { useSettings } from "@/hooks/useSettings";
import { type TocEntry, useTableOfContents } from "@/hooks/useTableOfContents";
import { useTabs } from "@/hooks/useTabs";
import { useWorkspaceNotice, type WorkspaceNotice } from "@/hooks/useWorkspaceNotice";
import { type Backlink, filterBacklinks } from "@/lib/backlinks";
import { displayContentFor, tocContentFor } from "@/lib/displayContent";
import { EDITOR_MODE } from "@/lib/settings";

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

export function TabsProvider({ children }: { children: ReactNode }) {
  const { settings, updateSettings } = useSettings();
  const workspaceNotice = useWorkspaceNotice();
  const tabs = useTabs({
    reopenLastFile: settings.behavior.reopenLastFile,
    openTabs: settings.behavior.openTabs,
    activeTabPath: settings.behavior.activeTabPath,
    recentFiles: settings.behavior.recentFiles,
    autoReload: settings.behavior.autoReload,
    defaultEditorMode: settings.behavior.defaultEditorMode,
    onSettingsChange: updateSettings,
    onWorkspaceNotice: workspaceNotice.show,
  });

  const activeMode = tabs.activeFile?.mode ?? EDITOR_MODE.view;
  const content = tabs.activeFile?.content ?? null;
  const activePath = tabs.activeFile?.path;
  // View mode shows saved content; edit/split shows the in-memory editContent
  // so previews reflect typing. editContent is seeded when entering edit mode,
  // so the `?? content` fallback is defensive only.
  const liveContent =
    activeMode !== EDITOR_MODE.view
      ? /* c8 ignore next */
        (tabs.activeFile?.editContent ?? content)
      : content;
  // Per-file-type derivation (markdown passthrough, notebook suppression,
  // canvas prose projection) lives in lib/displayContent.
  const displayContent = useMemo(
    () => displayContentFor(activePath, liveContent),
    [activePath, liveContent],
  );
  const tocEntries = useTableOfContents(tocContentFor(activePath, displayContent));
  const backlinks = useMemo(
    () =>
      tabs.activeFile?.path
        ? filterBacklinks(tabs.wikilinkRefs, tabs.workspaceFiles, tabs.activeFile.path)
        : [],
    [tabs.wikilinkRefs, tabs.workspaceFiles, tabs.activeFile?.path],
  );

  const value = useMemo<TabsContextValue>(
    () => ({
      ...tabs,
      displayContent,
      tocEntries,
      backlinks,
      workspaceNotice: workspaceNotice.notice,
      dismissWorkspaceNotice: workspaceNotice.dismiss,
    }),
    [tabs, displayContent, tocEntries, backlinks, workspaceNotice.notice, workspaceNotice.dismiss],
  );

  return <TabsContext.Provider value={value}>{children}</TabsContext.Provider>;
}

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
