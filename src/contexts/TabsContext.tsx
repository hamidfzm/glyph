import { createContext, type ReactNode, useContext, useMemo } from "react";
import { type TocEntry, useTableOfContents } from "@/hooks/useTableOfContents";
import { useTabs } from "@/hooks/useTabs";
import { type Backlink, filterBacklinks } from "@/lib/backlinks";
import { isNotebookFile } from "@/lib/notebookExtensions";
import { EDITOR_MODE, type Settings } from "@/lib/settings";

type TabsApi = ReturnType<typeof useTabs>;

export interface TabsContextValue extends TabsApi {
  // Derived from the active file + edit mode. View mode renders saved content;
  // edit/split renders the in-memory editContent so preview reflects typing.
  displayContent: string | null;
  tocEntries: TocEntry[];
  backlinks: Backlink[];
}

export const TabsContext = createContext<TabsContextValue | null>(null);

interface TabsProviderProps {
  settings: Settings;
  updateSettings: (key: string, value: unknown) => void;
  children: ReactNode;
}

export function TabsProvider({ settings, updateSettings, children }: TabsProviderProps) {
  const tabs = useTabs({
    reopenLastFile: settings.behavior.reopenLastFile,
    openTabs: settings.behavior.openTabs,
    activeTabPath: settings.behavior.activeTabPath,
    recentFiles: settings.behavior.recentFiles,
    autoReload: settings.behavior.autoReload,
    defaultEditorMode: settings.behavior.defaultEditorMode,
    onSettingsChange: updateSettings,
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
  const displayContent = isNotebook
    ? null
    : activeMode !== EDITOR_MODE.view
      ? // editContent is seeded when entering edit mode, so the `?? content`
        // fallback is defensive only.
        /* c8 ignore next */
        (tabs.activeFile?.editContent ?? content)
      : content;

  const tocEntries = useTableOfContents(displayContent);
  const backlinks = useMemo(
    () =>
      tabs.activeFile?.path
        ? filterBacklinks(tabs.wikilinkRefs, tabs.workspaceFiles, tabs.activeFile.path)
        : [],
    [tabs.wikilinkRefs, tabs.workspaceFiles, tabs.activeFile?.path],
  );

  const value = useMemo<TabsContextValue>(
    () => ({ ...tabs, displayContent, tocEntries, backlinks }),
    [tabs, displayContent, tocEntries, backlinks],
  );

  return <TabsContext.Provider value={value}>{children}</TabsContext.Provider>;
}

export function useTabsContext(): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("useTabsContext must be used inside <TabsProvider>");
  return ctx;
}
