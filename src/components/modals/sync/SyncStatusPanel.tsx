import { Trans, useTranslation } from "react-i18next";
import { relativeTime } from "@/lib/relativeTime";
import type { StatusReport, SyncResult } from "@/lib/sync";

interface SyncStatusPanelProps {
  status: StatusReport | null;
  lastSync: SyncResult | null;
}

/** Working-tree state, ahead/behind counts, and what the last run did. */
export function SyncStatusPanel({ status, lastSync }: SyncStatusPanelProps) {
  const { t } = useTranslation("sync");
  if (!status && !lastSync) return null;

  return (
    <div className="settings-sync-status" data-testid="sync-status">
      {status && (
        <>
          <div>
            <Trans
              i18nKey="sync:status.workingTree"
              components={{ strong: <strong /> }}
              values={{ state: status.clean ? t("status.clean") : t("status.dirty") }}
            />
          </div>
          <div>
            <Trans
              i18nKey="sync:status.aheadBehind"
              components={{ strong: <strong /> }}
              values={{ ahead: status.ahead, behind: status.behind }}
            />
          </div>
          {status.conflicts.length > 0 && (
            <div className="settings-warning">
              {t("status.conflicts", { files: status.conflicts.join(", ") })}
            </div>
          )}
          <div>{t("status.lastSync", { time: relativeTime(status.lastSyncUnix, t) })}</div>
        </>
      )}
      {lastSync && (
        <div>
          <Trans
            i18nKey="sync:status.lastRun"
            components={{ strong: <strong /> }}
            values={{
              pulled: lastSync.pulledCount,
              committed: lastSync.committedCount,
              pushed: lastSync.pushedCount,
              suffix:
                lastSync.conflicts.length > 0
                  ? t("status.lastRunConflicts", { count: lastSync.conflicts.length })
                  : "",
            }}
          />
        </div>
      )}
    </div>
  );
}
