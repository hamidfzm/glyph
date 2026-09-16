import { type ReactNode, useMemo } from "react";
import { RelinkConfirmModal } from "@/components/modals/RelinkConfirmModal";
import { UnsavedChangesModal, type UnsavedChoice } from "@/components/modals/UnsavedChangesModal";
import { useBacklinks } from "@/hooks/useBacklinks";
import { usePrompt } from "@/hooks/usePrompt";
import { useSettings } from "@/hooks/useSettings";
import { useTableOfContents } from "@/hooks/useTableOfContents";
import { useTabs } from "@/hooks/useTabs";
import { useWindowRegistrySync } from "@/hooks/useWindowRegistrySync";
import { useWorkspaceNotice } from "@/hooks/useWorkspaceNotice";
import { displayContentFor, tocContentFor } from "@/lib/displayContent";
import { EDITOR_MODE } from "@/lib/settings";
import type { RelinkRequest } from "@/lib/vault";
import { TabsContext, type TabsContextValue } from "./TabsContext";

export function TabsProvider({ children }: { children: ReactNode }) {
  const { settings, updateSettings } = useSettings();
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
  });

  // Report what this window shows so open requests route to the window already
  // showing a workspace or a note instead of opening it twice.
  useWindowRegistrySync(tabs.workspace, tabs.tabs, tabs.initializing);

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
  const backlinks = useBacklinks(tabs.workspace?.root, tabs.activeFile?.path, tabs.snapshot);

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
