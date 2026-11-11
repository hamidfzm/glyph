import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { SetupChoice } from "@/lib/settingsSync";

interface SettingsSyncChoiceProps {
  busy: boolean;
  onChoose: (choice: SetupChoice) => void;
  onDisconnect: () => void;
}

/** The first-connect question for a repo that already holds a setup. Nothing
 *  syncs, and nothing on this machine changes, until it is answered. */
export function SettingsSyncChoice({ busy, onChoose, onDisconnect }: SettingsSyncChoiceProps) {
  const { t } = useTranslation("sync");
  const titleId = useId();

  return (
    <section className="settings-sync-notice" aria-labelledby={titleId}>
      <strong id={titleId}>{t("settingsRepo.choice.title")}</strong>
      <p>{t("settingsRepo.choice.message")}</p>
      <ul>
        <li>{t("settingsRepo.choice.useSyncedHint")}</li>
        <li>{t("settingsRepo.choice.replaceSyncedHint")}</li>
      </ul>
      <div className="settings-actions">
        <button
          type="button"
          className="settings-primary-btn"
          onClick={() => onChoose("use-synced")}
          disabled={busy}
        >
          {t("settingsRepo.choice.useSynced")}
        </button>
        <button
          type="button"
          className="settings-secondary-btn"
          onClick={() => onChoose("replace-synced")}
          disabled={busy}
        >
          {t("settingsRepo.choice.replaceSynced")}
        </button>
        <button
          type="button"
          className="settings-danger-btn"
          onClick={onDisconnect}
          disabled={busy}
        >
          {t("settingsRepo.disconnect")}
        </button>
      </div>
    </section>
  );
}
