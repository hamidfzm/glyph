import { useTranslation } from "react-i18next";

/**
 * The trust line shown under every plugin row, installed or marketplace:
 * declared permissions (an explicit "None" when the plugin asks for nothing)
 * and the trust marker. Absent `sandbox` means sandboxed (the default); only
 * an explicit `false` shows the full-trust marker instead.
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
      {" · "}
      {sandbox === false ? t("fullTrustBadge") : t("sandboxBadge")}
    </div>
  );
}
