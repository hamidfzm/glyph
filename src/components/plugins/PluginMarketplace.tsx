import { useState } from "react";
import { useTranslation } from "react-i18next";
import { usePluginsOptional } from "@/contexts/PluginsContext";
import { filterRegistry, REGISTRY_CATEGORIES, type RegistryEntry } from "@/lib/plugins/marketplace";
import { PluginDetail } from "./PluginDetail";
import { PluginMarketplaceRow } from "./PluginMarketplaceRow";

const inputClass =
  "px-2 py-1 text-xs rounded border border-[var(--color-border)] bg-transparent text-[var(--color-text-primary)]";

/**
 * The marketplace section of Manage Plugins: search + category filter over
 * the not-yet-installed registry entries, with a per-plugin details view
 * (the plugin's registry README) a click away.
 */
export function PluginMarketplace() {
  const { t } = useTranslation("plugins");
  const plugins = usePluginsOptional();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [selected, setSelected] = useState<RegistryEntry | null>(null);

  if (!plugins) return null;

  const installedIds = new Set(plugins.installed.map((p) => p.id));
  const available = filterRegistry(
    plugins.registry.filter((e) => !installedIds.has(e.id)),
    query,
    category,
  );

  const handleInstall = (entry: RegistryEntry) => {
    setSelected(null);
    void plugins.installFromRegistry(entry);
  };

  return (
    <div>
      <h3 className="text-sm font-semibold text-[var(--color-text-secondary)] mt-5 mb-1">
        {t("availableHeading")}
      </h3>
      {selected ? (
        <PluginDetail entry={selected} onBack={() => setSelected(null)} onInstall={handleInstall} />
      ) : (
        <>
          <div className="flex items-center gap-2 mb-1">
            <input
              type="search"
              className={`${inputClass} flex-1 min-w-0`}
              placeholder={t("searchPlaceholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={t("searchPlaceholder")}
            />
            <select
              className={inputClass}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-label={t("categoryLabel")}
            >
              <option value="">{t("categoryAll")}</option>
              {REGISTRY_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`categories.${c}`)}
                </option>
              ))}
            </select>
          </div>
          {available.length === 0 ? (
            <p className="text-sm text-[var(--color-text-secondary)] py-2">{t("noAvailable")}</p>
          ) : (
            available.map((entry) => (
              <PluginMarketplaceRow
                key={entry.id}
                entry={entry}
                onSelect={setSelected}
                onInstall={handleInstall}
              />
            ))
          )}
        </>
      )}
    </div>
  );
}
