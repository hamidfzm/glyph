import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ConflictPick, ConflictSide } from "@/lib/settingsSync";
import { describeSyncFile } from "@/lib/settingsSyncFiles";
import { SettingsSyncConflictRow } from "./SettingsSyncConflictRow";

interface SettingsSyncConflictsProps {
  files: string[];
  busy: boolean;
  onResolve: (picks: ConflictPick[]) => void;
}

/** Files changed on both machines: a side for each, then one resolution. */
export function SettingsSyncConflicts({ files, busy, onResolve }: SettingsSyncConflictsProps) {
  const { t } = useTranslation("sync");
  const { t: ts } = useTranslation("settings");
  const titleId = useId();
  const [sides, setSides] = useState<Record<string, ConflictSide>>({});
  const picks: ConflictPick[] = files.flatMap((path) => {
    const side = sides[path];
    return side ? [{ path, side }] : [];
  });
  const isComplete = picks.length === files.length;

  return (
    <section className="settings-sync-notice" aria-labelledby={titleId}>
      <strong id={titleId}>{t("settingsRepo.conflicts.title")}</strong>
      <p>{t("settingsRepo.conflicts.message")}</p>
      <ul className="settings-sync-list">
        {files.map((path) => (
          <SettingsSyncConflictRow
            key={path}
            label={describeSyncFile(path, t, ts)}
            side={sides[path]}
            onPick={(side) => setSides((prev) => ({ ...prev, [path]: side }))}
          />
        ))}
      </ul>
      <div className="settings-actions">
        <button
          type="button"
          className="settings-primary-btn"
          onClick={() => onResolve(picks)}
          disabled={busy || !isComplete}
        >
          {t("settingsRepo.conflicts.resolve")}
        </button>
      </div>
    </section>
  );
}
