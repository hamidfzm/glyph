import { useCallback, useState } from "react";
import type { WorkspaceSettingsTabId } from "@/components/modals/workspace/WorkspaceSettingsModal";

/** Open/closed state of the shell's overlay modals, plus their openers. */
export function useAppModals() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Which Workspace Settings tab to show, or null while it is closed. Cloud
  // sync lives in that modal, so its opener just selects the Sync tab.
  const [workspaceSettingsTab, setWorkspaceSettingsTab] = useState<WorkspaceSettingsTabId | null>(
    null,
  );
  const [pluginsOpen, setPluginsOpen] = useState(false);

  return {
    settingsOpen,
    workspaceSettingsTab,
    pluginsOpen,
    setWorkspaceSettingsTab,
    openSettings: useCallback(() => setSettingsOpen(true), []),
    closeSettings: useCallback(() => setSettingsOpen(false), []),
    openSyncSettings: useCallback(() => setWorkspaceSettingsTab("sync"), []),
    openWorkspaceSettings: useCallback(() => setWorkspaceSettingsTab("website"), []),
    closeWorkspaceSettings: useCallback(() => setWorkspaceSettingsTab(null), []),
    openPlugins: useCallback(() => setPluginsOpen(true), []),
    closePlugins: useCallback(() => setPluginsOpen(false), []),
  };
}

export type AppModals = ReturnType<typeof useAppModals>;
