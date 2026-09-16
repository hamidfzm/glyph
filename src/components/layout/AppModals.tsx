import { SettingsModal } from "@/components/modals/settings/lazySettings";
import { WorkspaceSettingsModal } from "@/components/modals/workspace/lazyWorkspaceSettings";
import type { AppModals as AppModalsState } from "@/hooks/useAppModals";
import { useSpringPresence } from "@/hooks/useSpringPresence";

/** The shell's overlay modals. Each is mounted only while open so its chunk
 *  loads on first use rather than at startup. Settings opens and closes on a
 *  spring: the display-contents wrapper carries `--presence` (inherited by
 *  the overlay) and `data-spring` opts its CSS out of the keyframe path. */
export function AppModals({ modals }: { modals: AppModalsState }) {
  const settings = useSpringPresence(modals.settingsOpen);
  const settingsModal = settings.mounted && (
    <div key="settings" className="contents" data-spring ref={settings.ref}>
      <SettingsModal
        open
        tab={modals.settingsTab}
        onTabChange={modals.setSettingsTab}
        onClose={modals.closeSettings}
      />
    </div>
  );
  const workspaceSettingsModal = modals.workspaceSettingsTab && (
    <WorkspaceSettingsModal
      key="workspaceSettings"
      open
      tab={modals.workspaceSettingsTab}
      onTabChange={modals.setWorkspaceSettingsTab}
      onClose={modals.closeWorkspaceSettings}
    />
  );
  // Keyed, so reordering moves the overlays instead of remounting them (which
  // would drop the unsaved Workspace Settings form).
  return modals.settingsOnTop
    ? [workspaceSettingsModal, settingsModal]
    : [settingsModal, workspaceSettingsModal];
}
