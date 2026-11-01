import { useTranslation } from "react-i18next";
import type { SkippedFile, SkipReason } from "@/lib/settingsSync";
import { describeSyncFile } from "@/lib/settingsSyncFiles";

const REASON_KEYS: Record<SkipReason, string> = {
  "not-a-file": "notAFile",
  "not-a-folder": "notAFolder",
  "too-large": "tooLarge",
  "not-json": "notJson",
  "not-an-object": "notAnObject",
  "unknown-name": "unknownName",
  "duplicate-name": "duplicateName",
  "too-many": "tooMany",
  "bad-entry": "badEntry",
};

/** Files of the repo the last sync left out, each with why. */
export function SettingsSyncSkipped({ files }: { files: SkippedFile[] }) {
  const { t } = useTranslation("sync");
  const { t: ts } = useTranslation("settings");
  if (files.length === 0) return null;

  return (
    <div className="settings-sync-notice">
      <div>{t("settingsRepo.skipped.title")}</div>
      <ul>
        {files.map((file) => (
          <li key={file.path}>
            {t("settingsRepo.skipped.item", {
              file: describeSyncFile(file.path, t, ts),
              reason: t(`settingsRepo.skipped.reason.${REASON_KEYS[file.reason]}`),
            })}
          </li>
        ))}
      </ul>
    </div>
  );
}
