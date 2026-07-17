import { useContext } from "react";
import { useTranslation } from "react-i18next";
import { WarningIcon } from "@/components/icons/WarningIcon";
import { TabsContext } from "@/contexts/TabsContext";
import { indexIncompleteKey, truncatedScan } from "@/lib/workspaceScan";

/**
 * Persistent incomplete-index indicator pinned under the file tree (#436).
 * Unlike the dismissible workspace-notice banner, it stays visible for as long
 * as any workspace index is truncated; the tooltip carries the full message.
 * Reads the context optionally so isolated tests can render without a provider.
 */
export function WorkspaceIndexWarning() {
  const { t } = useTranslation(["common", "workspace"]);
  const indexStatus = useContext(TabsContext)?.indexStatus;
  const status = indexStatus ? truncatedScan(indexStatus) : null;
  if (!status) return null;

  return (
    <div
      role="status"
      title={t(indexIncompleteKey(status.reason), { ns: "workspace", limit: status.limit ?? 0 })}
      className="flex items-center gap-1.5 mt-1 px-1 py-0.5 text-xs text-[var(--color-warning,#b45309)] select-none shrink-0"
    >
      <WarningIcon />
      <span className="truncate">{t("sidebar.indexIncomplete")}</span>
    </div>
  );
}
