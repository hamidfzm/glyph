import { useTranslation } from "react-i18next";

/**
 * The trust line shown under every plugin row, installed or marketplace:
 * declared permissions (an explicit "None" when the plugin asks for nothing)
 * and a marker for sandboxed plugins.
 */
export function PluginPermissionsLine({
  permissions,
  sandbox,
}: {
  permissions?: string[];
  sandbox?: boolean;
}) {
  const { t } = useTranslation("plugins");
  return (
    <div className="text-xs text-[var(--color-text-secondary)] truncate">
      {t("permissionsLabel")}: {permissions?.length ? permissions.join(", ") : t("permissionsNone")}
      {sandbox && <> · {t("sandboxBadge")}</>}
    </div>
  );
}
