import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ModalCloseIcon } from "@/components/icons/ModalCloseIcon";
import { usePluginsOptional } from "@/contexts/PluginsContext";
import { useRegistryEntries } from "@/hooks/usePluginRegistry";
import { PluginMountSlot } from "./PluginMountSlot";

const rowClass =
  "flex items-start gap-3 py-3 border-b border-[var(--color-border)] last:border-b-0";
const btnClass =
  "px-2 py-1 text-xs rounded border border-[var(--color-border)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-secondary)]";

/**
 * VS Code-style plugin manager: list installed plugins (toggle active, update,
 * remove), browse marketplace entries not yet installed (install), and install
 * from a local folder. All actions go through the plugins context.
 */
export function PluginsModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation("plugins");
  const plugins = usePluginsOptional();
  const settingsPanels = useRegistryEntries(plugins?.settingsPanels ?? null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleBackdrop = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  if (!plugins) return null;

  const updatesById = new Map(plugins.updates.map((u) => [u.entry.id, u.entry]));
  const installedIds = new Set(plugins.installed.map((p) => p.id));
  const available = plugins.registry.filter((e) => !installedIds.has(e.id));

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape is handled globally above.
    <div className="settings-overlay" onClick={handleBackdrop} role="dialog" aria-modal="true">
      <div className="settings-modal">
        <div className="settings-header">
          <h2>{t("title")}</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={btnClass}
              onClick={() => void plugins.installFromFolder()}
            >
              {t("installFromFolder")}
            </button>
            <button type="button" className="settings-close" onClick={onClose} aria-label="Close">
              <ModalCloseIcon />
            </button>
          </div>
        </div>

        <div className="p-4 overflow-y-auto">
          <h3 className="text-sm font-semibold text-[var(--color-text-secondary)] mb-1">
            {t("installedHeading")}
          </h3>
          {plugins.installed.length === 0 ? (
            <p className="text-sm text-[var(--color-text-secondary)] py-2">{t("noInstalled")}</p>
          ) : (
            plugins.installed.map((p) => {
              const enabled = !plugins.disabled.includes(p.id);
              const update = updatesById.get(p.id);
              const settingsPanel = settingsPanels.find((panel) => panel.pluginId === p.id);
              return (
                <div key={p.id} className={rowClass}>
                  <label className="flex items-center pt-0.5">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={() => void plugins.setEnabled(p.id, !enabled)}
                      aria-label={t("enable", { name: p.name })}
                    />
                  </label>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-[var(--color-text-primary)]">
                      {p.name}{" "}
                      <span className="text-[var(--color-text-secondary)]">v{p.version}</span>
                    </div>
                    {p.description && (
                      <div className="text-xs text-[var(--color-text-secondary)] truncate">
                        {p.description}
                      </div>
                    )}
                    <div className="text-xs text-[var(--color-text-secondary)] truncate">
                      {t("permissionsLabel")}:{" "}
                      {p.permissions?.length ? p.permissions.join(", ") : t("permissionsNone")}
                      {p.sandbox && <> · {t("sandboxBadge")}</>}
                    </div>
                    {settingsPanel && enabled && (
                      <div className="mt-2 text-xs text-[var(--color-text-primary)]">
                        <PluginMountSlot contribution={settingsPanel} />
                      </div>
                    )}
                  </div>
                  {update && (
                    <button
                      type="button"
                      className={btnClass}
                      onClick={() => void plugins.installFromRegistry(update)}
                    >
                      {t("updateTo", { version: update.version })}
                    </button>
                  )}
                  <button
                    type="button"
                    className={btnClass}
                    onClick={() => void plugins.uninstall(p.id)}
                  >
                    {t("remove")}
                  </button>
                </div>
              );
            })
          )}

          <h3 className="text-sm font-semibold text-[var(--color-text-secondary)] mt-5 mb-1">
            {t("availableHeading")}
          </h3>
          {available.length === 0 ? (
            <p className="text-sm text-[var(--color-text-secondary)] py-2">{t("noAvailable")}</p>
          ) : (
            available.map((e) => (
              <div key={e.id} className={rowClass}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-[var(--color-text-primary)]">
                    {e.name}{" "}
                    <span className="text-[var(--color-text-secondary)]">v{e.version}</span>
                  </div>
                  {e.description && (
                    <div className="text-xs text-[var(--color-text-secondary)] truncate">
                      {e.description}
                    </div>
                  )}
                  <div className="text-xs text-[var(--color-text-secondary)] truncate">
                    {t("permissionsLabel")}:{" "}
                    {e.permissions?.length ? e.permissions.join(", ") : t("permissionsNone")}
                    {e.sandbox && <> · {t("sandboxBadge")}</>}
                  </div>
                </div>
                <button
                  type="button"
                  className={btnClass}
                  onClick={() => void plugins.installFromRegistry(e)}
                >
                  {t("install")}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
