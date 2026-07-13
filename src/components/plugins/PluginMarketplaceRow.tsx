import { useTranslation } from "react-i18next";
import type { RegistryEntry } from "@/lib/plugins/marketplace";
import { PluginPermissionsLine } from "./PluginPermissionsLine";

const rowClass =
  "flex items-start gap-3 py-3 border-b border-[var(--color-border)] last:border-b-0";
const btnClass =
  "px-2 py-1 text-xs rounded border border-[var(--color-border)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-secondary)]";

/**
 * One marketplace listing: name, badges, description, and trust line, with
 * the whole text area clickable to open the details view.
 */
export function PluginMarketplaceRow({
  entry,
  onSelect,
  onInstall,
}: {
  entry: RegistryEntry;
  onSelect: (entry: RegistryEntry) => void;
  onInstall: (entry: RegistryEntry) => void;
}) {
  const { t } = useTranslation("plugins");
  return (
    <div className={rowClass}>
      <button
        type="button"
        className="flex-1 min-w-0 text-left cursor-pointer bg-transparent border-0 p-0"
        onClick={() => onSelect(entry)}
      >
        <div className="text-sm text-[var(--color-text-primary)]">
          {entry.name} <span className="text-[var(--color-text-secondary)]">v{entry.version}</span>
          {entry.official && (
            <span className="ml-2 px-1.5 py-0.5 text-[10px] uppercase rounded bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)]">
              {t("officialBadge")}
            </span>
          )}
        </div>
        {entry.description && (
          <div className="text-xs text-[var(--color-text-secondary)] truncate">
            {entry.description}
          </div>
        )}
        <PluginPermissionsLine permissions={entry.permissions} sandbox={entry.sandbox} />
      </button>
      <button type="button" className={btnClass} onClick={() => onInstall(entry)}>
        {t("install")}
      </button>
    </div>
  );
}
