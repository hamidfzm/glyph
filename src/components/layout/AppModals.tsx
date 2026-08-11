import { SettingsModal } from "@/components/modals/settings/lazySettings";
import { WorkspaceSettingsModal } from "@/components/modals/workspace/lazyWorkspaceSettings";
import { PluginsModal } from "@/components/plugins/lazyPluginsModal";
import type { AppModals as AppModalsState } from "@/hooks/useAppModals";
import { useSpringPresence } from "@/hooks/useSpringPresence";

/** The shell's overlay modals. Each is mounted only while open so its chunk
 *  loads on first use rather than at startup. Settings opens and closes on a
 *  spring: the display-contents wrapper carries `--presence` (inherited by
 *  the overlay) and `data-spring` opts its CSS out of the keyframe path. */
export function AppModals({ modals }: { modals: AppModalsState }) {
  const settings = useSpringPresence(modals.settingsOpen);
  return (
    <>
      {settings.mounted && (
        <div className="contents" data-spring ref={settings.ref}>
          <SettingsModal open onClose={modals.closeSettings} />
        </div>
      )}
      {modals.workspaceSettingsTab && (
        <WorkspaceSettingsModal
          open
          tab={modals.workspaceSettingsTab}
          onTabChange={modals.setWorkspaceSettingsTab}
          onClose={modals.closeWorkspaceSettings}
        />
      )}
      {modals.pluginsOpen && <PluginsModal onClose={modals.closePlugins} />}
    </>
  );
}
