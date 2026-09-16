import { useCallback, useState } from "react";
import type { SettingsTabId } from "@/components/modals/settings/SettingsModal";
import type { WorkspaceSettingsTabId } from "@/components/modals/workspace/WorkspaceSettingsModal";

/** Open/closed state of the shell's overlay modals, plus their openers. */
export function useAppModals() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Kept apart from settingsOpen: the modal stays mounted through its close
  // spring, and clearing the tab then would swap the content mid-exit.
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>("appearance");
  // Which Workspace Settings tab to show, or null while it is closed. Cloud
  // sync lives in that modal, so its opener just selects the Sync tab.
  const [workspaceSettingsTab, setWorkspaceSettingsTab] = useState<WorkspaceSettingsTabId | null>(
    null,
  );
  // Both overlays share one z-index, so the shell orders them by which opened last.
  const [settingsOnTop, setSettingsOnTop] = useState(false);

  return {
    settingsOpen,
    settingsTab,
    workspaceSettingsTab,
    settingsOnTop,
    setSettingsTab,
    setWorkspaceSettingsTab,
    openSettings: useCallback(() => {
      setSettingsOpen(true);
      setSettingsOnTop(true);
    }, []),
    // Plugin management is the Settings modal's Plugins tab.
    openPlugins: useCallback(() => {
      setSettingsTab("plugins");
      setSettingsOpen(true);
      setSettingsOnTop(true);
    }, []),
    closeSettings: useCallback(() => setSettingsOpen(false), []),
    openSyncSettings: useCallback(() => {
      setWorkspaceSettingsTab("sync");
      setSettingsOnTop(false);
    }, []),
    openWorkspaceSettings: useCallback(() => {
      setWorkspaceSettingsTab("website");
      setSettingsOnTop(false);
    }, []),
    closeWorkspaceSettings: useCallback(() => setWorkspaceSettingsTab(null), []),
  };
}

export type AppModals = ReturnType<typeof useAppModals>;
