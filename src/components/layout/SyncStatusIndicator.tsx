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

import { useSyncConfigContext } from "@/contexts/SyncConfigContext";

interface SyncStatusIndicatorProps {
  onOpenSync: () => void;
}

export function relativeTime(unix: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - unix);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function summarise(
  config: ReturnType<typeof useSyncConfigContext>["config"],
  status: ReturnType<typeof useSyncConfigContext>["status"],
): { label: string; tone: "off" | "ok" | "warn" | "error" } {
  if (!config) return { label: "Sync off", tone: "off" };
  if (!status) return { label: "Sync configured", tone: "ok" };
  if (status.conflicts.length > 0) {
    return { label: `Conflicts (${status.conflicts.length})`, tone: "error" };
  }
  if (status.ahead > 0 || status.behind > 0) {
    return { label: `Sync +${status.ahead}/-${status.behind}`, tone: "warn" };
  }
  if (!status.clean) return { label: "Sync: dirty", tone: "warn" };
  if (status.lastSyncUnix) {
    return { label: `Synced ${relativeTime(status.lastSyncUnix)}`, tone: "ok" };
  }
  return { label: "Synced", tone: "ok" };
}

export function SyncStatusIndicator({ onOpenSync }: SyncStatusIndicatorProps) {
  const { config, status, workspacePath } = useSyncConfigContext();
  if (!workspacePath) return null;

  const { label, tone } = summarise(config, status);

  return (
    <button
      type="button"
      onClick={onOpenSync}
      className="status-sync-indicator"
      data-tone={tone}
      title="Open Cloud Sync settings"
    >
      {label}
    </button>
  );
}
