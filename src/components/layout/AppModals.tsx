import { SyncSettingsModal } from "@/components/modals/SyncSettingsModal";
import { SettingsModal } from "@/components/modals/settings/lazySettings";
import { WorkspaceSettingsModal } from "@/components/modals/workspace/WorkspaceSettingsModal";
import { PluginsModal } from "@/components/plugins/PluginsModal";
import type { AppModals as AppModalsState } from "@/hooks/useAppModals";

/** The shell's overlay modals. Each is mounted only while open so its chunk
 *  loads on first use rather than at startup. */
export function AppModals({ modals }: { modals: AppModalsState }) {
  return (
    <>
      {modals.settingsOpen && <SettingsModal open onClose={modals.closeSettings} />}
      {modals.syncSettingsOpen && <SyncSettingsModal open onClose={modals.closeSyncSettings} />}
      {modals.workspaceSettingsOpen && (
        <WorkspaceSettingsModal open onClose={modals.closeWorkspaceSettings} />
      )}
      {modals.pluginsOpen && <PluginsModal onClose={modals.closePlugins} />}
    </>
  );
}
