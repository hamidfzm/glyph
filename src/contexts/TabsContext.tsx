import { createContext, type ReactNode, useContext, useMemo } from "react";
import { type TocEntry, useTableOfContents } from "@/hooks/useTableOfContents";
import { useTabs } from "@/hooks/useTabs";
import { useWorkspaceNotice } from "@/hooks/useWorkspaceNotice";
import { type Backlink, filterBacklinks } from "@/lib/backlinks";
import { canvasDisplayText } from "@/lib/canvas/canvasText";
import { isCanvasFile } from "@/lib/canvasExtensions";
import { isNotebookFile } from "@/lib/notebookExtensions";
import { EDITOR_MODE, type Settings } from "@/lib/settings";

type TabsApi = ReturnType<typeof useTabs>;

export interface TabsContextValue extends TabsApi {
  // Derived from the active file + edit mode. View mode renders saved content;
  // edit/split renders the in-memory editContent so preview reflects typing.
  displayContent: string | null;
  tocEntries: TocEntry[];
  backlinks: Backlink[];
  // Transient message shown when a folder is refused as a workspace (#262).
  workspaceNotice: string | null;
  dismissWorkspaceNotice: () => void;
}

export const TabsContext = createContext<TabsContextValue | null>(null);

interface TabsProviderProps {
  settings: Settings;
  updateSettings: (key: string, value: unknown) => void;
  children: ReactNode;
}

export function TabsProvider({ settings, updateSettings, children }: TabsProviderProps) {
  const workspaceNotice = useWorkspaceNotice();
  const tabs = useTabs({
    reopenLastFile: settings.behavior.reopenLastFile,
    openTabs: settings.behavior.openTabs,
    activeTabPath: settings.behavior.activeTabPath,
    recentFiles: settings.behavior.recentFiles,
    autoReload: settings.behavior.autoReload,
    defaultEditorMode: settings.behavior.defaultEditorMode,
    onSettingsChange: updateSettings,
    onWorkspaceRefusal: workspaceNotice.show,
  });

  const activeMode = tabs.activeFile?.mode ?? EDITOR_MODE.view;
  const content = tabs.activeFile?.content ?? null;
  const activePath = tabs.activeFile?.path;
  // A notebook never has a markdown body — view mode shows the rich cell
  // viewer, edit/split shows the raw `.ipynb` JSON read-only. Either way the
  // features that read `displayContent` (word count, TOC, AI, read-aloud) would
  // be chewing on raw JSON, which is worse than nothing. Suppress it in every
  // mode so a notebook is never mistaken for editable markdown text.
  const isNotebook = !!activePath && isNotebookFile(activePath);
  // A canvas is JSON too, but its boards carry real prose: project the text
  // cards, group labels, and link URLs so word count, AI, and read-aloud work
  // on the content rather than the syntax.
  const isCanvas = !!activePath && isCanvasFile(activePath);
  const liveContent =
    activeMode !== EDITOR_MODE.view
      ? // editContent is seeded when entering edit mode, so the `?? content`
        // fallback is defensive only.
        /* c8 ignore next */
        (tabs.activeFile?.editContent ?? content)
      : content;
  const displayContent = useMemo(() => {
    if (isNotebook) return null;
    if (isCanvas) return liveContent ? canvasDisplayText(liveContent) : null;
    return liveContent;
  }, [isNotebook, isCanvas, liveContent]);

  // TOC entries navigate by scrolling the document; the board has no heading
  // scroll targets, so a canvas keeps the outline empty.
  const tocEntries = useTableOfContents(isCanvas ? null : displayContent);
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
