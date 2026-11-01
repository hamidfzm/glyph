import { useTranslation } from "react-i18next";
import { usePluginReconcile } from "@/hooks/usePluginReconcile";
import { useSettingsSync } from "@/hooks/useSettingsSync";
import { SettingsSyncChoice } from "./SettingsSyncChoice";
import { SettingsSyncConflicts } from "./SettingsSyncConflicts";
import { SettingsSyncConnected } from "./SettingsSyncConnected";
import { SettingsSyncPlugins } from "./SettingsSyncPlugins";
import { SettingsSyncSetup } from "./SettingsSyncSetup";
import { SettingsSyncSkipped } from "./SettingsSyncSkipped";

/** The app-wide settings repo: connect it, answer the first-connect
 *  question, sync, resolve conflicts, and bring plugins in line. */
export function SettingsSyncTab() {
  const { t } = useTranslation("sync");
  const sync = useSettingsSync();
  const reconcile = usePluginReconcile(sync.plan);

  if (sync.loading) {
    return (
      <div className="settings-sync">
        <p className="settings-busy">{t("loading")}</p>
      </div>
    );
  }
  const phase = sync.config?.phase;

  return (
    // `settings-sync` carries the sync forms' field, segmented-control and
    // action styles, shared with the workspace Sync tab.
    <div className="settings-sync">
      <p className="settings-section-description">{t("settingsRepo.description")}</p>
      {!sync.config && (
        <SettingsSyncSetup
          defaultAuthor={sync.defaultAuthor}
          busy={sync.busy}
          onConnect={(request) => void sync.connect(request)}
        />
      )}
      {phase === "choosing" && (
        <SettingsSyncChoice
          busy={sync.busy}
          onChoose={(choice) => void sync.choose(choice)}
          onDisconnect={() => void sync.disconnect()}
        />
      )}
      {sync.config && phase === "active" && (
        <>
          <SettingsSyncConnected
            config={sync.config}
            status={sync.status}
            lastResult={sync.lastResult}
            tokenStored={sync.tokenStored}
            busy={sync.busy}
            hasConflicts={sync.conflicts.length > 0}
            onSyncNow={() => void sync.syncNow()}
            onDisconnect={() => void sync.disconnect()}
            onSaveToken={(token) => void sync.saveToken(token)}
            onRemoveToken={() => void sync.removeToken()}
          />
          {sync.conflicts.length > 0 && (
            <SettingsSyncConflicts
              files={sync.conflicts}
              busy={sync.busy}
              onResolve={(picks) => void sync.resolve(picks)}
            />
          )}
          <SettingsSyncPlugins reconcile={reconcile} />
          <SettingsSyncSkipped files={sync.skipped} />
        </>
      )}
      {sync.error && (
        <p className="settings-error" role="alert">
          {sync.error}
        </p>
      )}
    </div>
  );
}
