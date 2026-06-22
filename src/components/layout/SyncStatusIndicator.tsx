// Tiny per-workspace sync status pill on the status bar.
//
// Renders nothing on single-file tabs or unconfigured workspaces unless
// the user explicitly opted in to a setup hint. When sync IS configured,
// shows a short summary of the current state ("Synced 2m ago", "Conflicts (2)",
// "+1/-3", "dirty"). Clicking opens the Cloud Sync modal so the user can
// inspect or trigger a sync.
//
// Config/status come from the shared `SyncConfigContext`, the same instance
// the Cloud Sync modal writes to, so enabling sync there updates this pill
// immediately. We deliberately don't poll for fresh status here — the pill
// shows whatever was last loaded or refreshed.

import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useSyncConfigContext } from "@/contexts/SyncConfigContext";

interface SyncStatusIndicatorProps {
  onOpenSync: () => void;
}

export function relativeTime(unix: number, t: TFunction<"sync">): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - unix);
  if (seconds < 60) return t("relativeTime.secondsAgo", { count: seconds });
  if (seconds < 3600) return t("relativeTime.minutesAgo", { count: Math.floor(seconds / 60) });
  if (seconds < 86400) return t("relativeTime.hoursAgo", { count: Math.floor(seconds / 3600) });
  return t("relativeTime.daysAgo", { count: Math.floor(seconds / 86400) });
}

export function summarise(
  config: ReturnType<typeof useSyncConfigContext>["config"],
  status: ReturnType<typeof useSyncConfigContext>["status"],
  t: TFunction<"sync">,
): { label: string; tone: "off" | "ok" | "warn" | "error" } {
  if (!config) return { label: t("indicator.off"), tone: "off" };
  if (!status) return { label: t("indicator.configured"), tone: "ok" };
  if (status.conflicts.length > 0) {
    return { label: t("indicator.conflicts", { count: status.conflicts.length }), tone: "error" };
  }
  if (status.ahead > 0 || status.behind > 0) {
    return {
      label: t("indicator.changes", { ahead: status.ahead, behind: status.behind }),
      tone: "warn",
    };
  }
  if (!status.clean) return { label: t("indicator.dirty"), tone: "warn" };
  if (status.lastSyncUnix) {
    return {
      label: t("indicator.synced", { time: relativeTime(status.lastSyncUnix, t) }),
      tone: "ok",
    };
  }
  return { label: t("indicator.syncedDefault"), tone: "ok" };
}

export function SyncStatusIndicator({ onOpenSync }: SyncStatusIndicatorProps) {
  const { t } = useTranslation("sync");
  const { config, status, workspacePath } = useSyncConfigContext();
  if (!workspacePath) return null;

  const { label, tone } = summarise(config, status, t);

  return (
    <button
      type="button"
      onClick={onOpenSync}
      className="status-sync-indicator"
      data-tone={tone}
      title={t("indicator.open")}
    >
      {label}
    </button>
  );
}
