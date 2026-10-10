import { type ReactNode, useMemo, useSyncExternalStore } from "react";
import { RelinkConfirmModal } from "@/components/modals/RelinkConfirmModal";
import { UnsavedChangesModal, type UnsavedChoice } from "@/components/modals/UnsavedChangesModal";
import { usePluginsOptional } from "@/contexts/PluginsContext";
import { usePrompt } from "@/hooks/usePrompt";
import { useSettings } from "@/hooks/useSettings";
import { useTableOfContents } from "@/hooks/useTableOfContents";
import { useTabs } from "@/hooks/useTabs";
import { useWindowRegistrySync } from "@/hooks/useWindowRegistrySync";
import { useWorkspaceNotice } from "@/hooks/useWorkspaceNotice";
import { displayContentFor, tocContentFor } from "@/lib/displayContent";
import { fileTypes } from "@/lib/plugins/fileTypes";
import { liveContentOf } from "@/lib/tabs";
import type { RelinkRequest } from "@/lib/vault";
import { TabsContext, type TabsContextValue } from "./TabsContext";

export function TabsProvider({ children }: { children: ReactNode }) {
  const { settings, updateSettings } = useSettings();
  const pluginsReady = usePluginsOptional()?.initialLoadDone ?? true;
  const workspaceNotice = useWorkspaceNotice();
  const unsavedPrompt = usePrompt<string[], UnsavedChoice>("cancel");
  const relinkPrompt = usePrompt<RelinkRequest, boolean>(false);
  const tabs = useTabs({
    reopenLastFile: settings.behavior.reopenLastFile,
    openTabs: settings.behavior.openTabs,
    activeTabPath: settings.behavior.activeTabPath,
    recentFiles: settings.behavior.recentFiles,
    autoReload: settings.behavior.autoReload,
    autoSave: settings.behavior.autoSave,
    defaultEditorMode: settings.behavior.defaultEditorMode,
    onSettingsChange: updateSettings,
    onWorkspaceNotice: workspaceNotice.show,
    confirmUnsaved: unsavedPrompt.confirm,
    confirmRelink: relinkPrompt.confirm,
    pluginsReady,
  });

  // Report what this window shows so open requests route to the window already
  // showing a workspace or a note instead of opening it twice.
  useWindowRegistrySync(tabs.workspace, tabs.tabs, tabs.initializing);

  const activePath = tabs.activeFile?.path;
  // The text the active pane renders in every mode, so the outline, word
  // count, export, and read aloud describe a dirty tab's unsaved edits too.
  const liveContent = tabs.activeFile ? liveContentOf(tabs.activeFile) : null;
  // Per-file-type derivation (markdown passthrough, notebook suppression,
  // canvas prose projection) lives in lib/displayContent. A plugin file type
  // registering or going away changes the answer for an open tab.
  const registeredFileTypes = useSyncExternalStore(fileTypes.subscribe, fileTypes.list);
  const displayContent = useMemo(
    () => displayContentFor(activePath, liveContent, registeredFileTypes),
    [activePath, liveContent, registeredFileTypes],
  );
  const tocEntries = useTableOfContents(tocContentFor(activePath, displayContent));

  const value = useMemo<TabsContextValue>(
    () => ({
      ...tabs,
      displayContent,
      tocEntries,
      workspaceNotice: workspaceNotice.notice,
      dismissWorkspaceNotice: workspaceNotice.dismiss,
    }),
    [tabs, displayContent, tocEntries, workspaceNotice.notice, workspaceNotice.dismiss],
  );

  return (
    <TabsContext.Provider value={value}>
      {children}
      {unsavedPrompt.request && unsavedPrompt.request.length > 0 && (
        <UnsavedChangesModal files={unsavedPrompt.request} onChoose={unsavedPrompt.choose} />
      )}
      {relinkPrompt.request && (
        <RelinkConfirmModal request={relinkPrompt.request} onChoose={relinkPrompt.choose} />
      )}
    </TabsContext.Provider>
  );
}
