import { useTranslation } from "react-i18next";
import { usePluginsOptional } from "@/contexts/PluginsContext";
import { useRegistryEntries } from "@/hooks/usePluginRegistry";
import { CorePluginsSection } from "./CorePluginsSection";
import { PluginMarketplace } from "./PluginMarketplace";
import { PluginMountSlot } from "./PluginMountSlot";
import { PluginPermissionsLine } from "./PluginPermissionsLine";

const rowClass =
  "flex items-start gap-3 py-3 border-b border-[var(--color-border)] last:border-b-0";
const btnClass =
  "px-2 py-1 text-xs rounded border border-[var(--color-border)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-secondary)]";

/**
 * The Plugins tab of Settings, VS Code-style: list installed plugins (toggle
 * active, update, remove), browse marketplace entries not yet installed
 * (install), and install from a local folder. All actions go through the
 * plugins context.
 */
export function PluginsTab() {
  const { t } = useTranslation("plugins");
  const plugins = usePluginsOptional();
  const settingsPanels = useRegistryEntries(plugins?.settingsPanels ?? null);

  if (!plugins) return null;

  const updatesById = new Map(plugins.updates.map((u) => [u.entry.id, u.entry]));

  return (
    <div>
      <CorePluginsSection />
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-[var(--color-text-secondary)]">
          {t("communityHeading")}
        </h3>
        <button type="button" className={btnClass} onClick={() => void plugins.installFromFolder()}>
          {t("installFromFolder")}
        </button>
      </div>
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
                  {p.name} <span className="text-[var(--color-text-secondary)]">v{p.version}</span>
                </div>
                {p.description && (
                  <div className="text-xs text-[var(--color-text-secondary)] truncate">
                    {p.description}
                  </div>
                )}
                <PluginPermissionsLine permissions={p.permissions} sandbox={p.sandbox} />
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

      <PluginMarketplace />
    </div>
  );
}
