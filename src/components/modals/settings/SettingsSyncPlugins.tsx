import { useTranslation } from "react-i18next";
import type { PluginReconcile } from "@/hooks/usePluginReconcile";
import { SettingsSyncPluginRow } from "./SettingsSyncPluginRow";

interface SettingsSyncPluginsProps {
  reconcile: PluginReconcile;
}

/** The synced setup's plugins this machine still has to act on. Installing
 *  or turning one on goes through the usual consent prompt. */
export function SettingsSyncPlugins({ reconcile }: SettingsSyncPluginsProps) {
  const { t } = useTranslation("sync");
  const { reconciliation, pendingId, install, installAll, enable } = reconcile;
  const { missing, toEnable, manual } = reconciliation;
  if (missing.length === 0 && toEnable.length === 0 && manual.length === 0) return null;
  const isBusy = pendingId !== null;

  return (
    <div className="settings-section">
      <div className="settings-section-title">{t("settingsRepo.plugins.title")}</div>
      {missing.length > 0 && (
        <>
          <div className="settings-row">
            <span className="settings-description">{t("settingsRepo.plugins.missing")}</span>
            {missing.length > 1 && (
              <button
                type="button"
                className="settings-secondary-btn"
                onClick={() => void installAll()}
                disabled={isBusy}
              >
                {t("settingsRepo.plugins.installAll")}
              </button>
            )}
          </div>
          <ul className="settings-sync-list">
            {missing.map((entry) => (
              <SettingsSyncPluginRow
                key={entry.id}
                name={entry.name}
                detail={t("settingsRepo.plugins.version", { version: entry.version })}
                action={{
                  label: t("settingsRepo.plugins.install"),
                  ariaLabel: t("settingsRepo.plugins.installName", { name: entry.name }),
                  onClick: () => void install(entry.id),
                  disabled: isBusy,
                }}
              />
            ))}
          </ul>
        </>
      )}
      {toEnable.length > 0 && (
        <>
          <div className="settings-description">{t("settingsRepo.plugins.toEnable")}</div>
          <ul className="settings-sync-list">
            {toEnable.map((plugin) => (
              <SettingsSyncPluginRow
                key={plugin.id}
                name={plugin.name}
                detail={t("settingsRepo.plugins.offHere")}
                action={{
                  label: t("settingsRepo.plugins.enable"),
                  ariaLabel: t("settingsRepo.plugins.enableName", { name: plugin.name }),
                  onClick: () => void enable(plugin.id),
                  disabled: isBusy,
                }}
              />
            ))}
          </ul>
        </>
      )}
      {manual.length > 0 && (
        <>
          <div className="settings-description">{t("settingsRepo.plugins.manual")}</div>
          <ul className="settings-sync-list">
            {manual.map(({ plugin, reason }) => (
              <SettingsSyncPluginRow
                key={plugin.id}
                name={plugin.id}
                detail={t(`settingsRepo.plugins.reason.${reason}`, { version: plugin.version })}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
