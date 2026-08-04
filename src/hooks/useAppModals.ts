import { useCallback, useState } from "react";

/** Open/closed state of the shell's overlay modals, plus their openers. */
export function useAppModals() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [syncSettingsOpen, setSyncSettingsOpen] = useState(false);
  const [workspaceSettingsOpen, setWorkspaceSettingsOpen] = useState(false);
  const [pluginsOpen, setPluginsOpen] = useState(false);

  return {
    settingsOpen,
    syncSettingsOpen,
    workspaceSettingsOpen,
    pluginsOpen,
    openSettings: useCallback(() => setSettingsOpen(true), []),
    closeSettings: useCallback(() => setSettingsOpen(false), []),
    openSyncSettings: useCallback(() => setSyncSettingsOpen(true), []),
    closeSyncSettings: useCallback(() => setSyncSettingsOpen(false), []),
    openWorkspaceSettings: useCallback(() => setWorkspaceSettingsOpen(true), []),
    closeWorkspaceSettings: useCallback(() => setWorkspaceSettingsOpen(false), []),
    openPlugins: useCallback(() => setPluginsOpen(true), []),
    closePlugins: useCallback(() => setPluginsOpen(false), []),
  };
}

export type AppModals = ReturnType<typeof useAppModals>;
