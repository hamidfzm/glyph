import { useTranslation } from "react-i18next";
import { Toggle } from "@/components/modals/settings/Toggle";
import { usePluginsOptional } from "@/contexts/PluginsContext";
import { useRegistryEntries } from "@/hooks/usePluginRegistry";
import { useSettings } from "@/hooks/useSettings";
import { CORE_PLUGINS } from "@/lib/plugins/corePlugins";
import { PluginMountSlot } from "./PluginMountSlot";

/** Bundled first-party plugins, each switched on or off from its setting. */
export function CorePluginsSection() {
  const { t } = useTranslation("plugins");
  const { settings, updateSettings } = useSettings();
  const settingsPanels = useRegistryEntries(usePluginsOptional()?.settingsPanels ?? null);

  return (
    <section className="mb-5">
      <h3 className="text-sm font-semibold text-[var(--color-text-secondary)] mb-1">
        {t("coreHeading")}
      </h3>
      {CORE_PLUGINS.map(({ id, settingsKey }) => {
        // A panel is registered only while its plugin is loaded, so on.
        const settingsPanel = settingsPanels.find((panel) => panel.pluginId === id);
        return (
          <div
            key={id}
            className="flex items-center gap-3 py-3 border-b border-[var(--color-border)] last:border-b-0"
          >
            <div className="flex-1 min-w-0">
              <div className="text-sm text-[var(--color-text-primary)]">
                {t(`core.${settingsKey}.name`)}
              </div>
              <div className="text-xs text-[var(--color-text-secondary)]">
                {t(`core.${settingsKey}.description`)}
              </div>
              {settingsPanel && (
                <div className="mt-2 text-xs text-[var(--color-text-primary)]">
                  <PluginMountSlot contribution={settingsPanel} />
                </div>
              )}
            </div>
            <Toggle
              checked={settings.corePlugins[settingsKey]}
              onChange={(on) => updateSettings(`corePlugins.${settingsKey}`, on)}
              label={t("enable", { name: t(`core.${settingsKey}.name`) })}
            />
          </div>
        );
      })}
    </section>
  );
}
