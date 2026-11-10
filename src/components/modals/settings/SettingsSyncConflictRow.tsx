import { useTranslation } from "react-i18next";
import type { ConflictSide } from "@/lib/settingsSync";

interface SettingsSyncConflictRowProps {
  /** The file as the user knows it. */
  label: string;
  side: ConflictSide | undefined;
  onPick: (side: ConflictSide) => void;
}

const SIDES: { side: ConflictSide; labelKey: string }[] = [
  { side: "local", labelKey: "settingsRepo.conflicts.keepLocal" },
  { side: "remote", labelKey: "settingsRepo.conflicts.takeRemote" },
];

/** One conflicted file, and which side of it to keep. */
export function SettingsSyncConflictRow({ label, side, onPick }: SettingsSyncConflictRowProps) {
  const { t } = useTranslation("sync");

  return (
    <li className="settings-row">
      <span className="settings-label">{label}</span>
      <fieldset aria-label={t("settingsRepo.conflicts.legend", { file: label })}>
        <div className="settings-segmented">
          {SIDES.map((option) => (
            <button
              key={option.side}
              type="button"
              aria-pressed={side === option.side}
              className="settings-segmented-option"
              data-active={side === option.side}
              onClick={() => onPick(option.side)}
            >
              {t(option.labelKey)}
            </button>
          ))}
        </div>
      </fieldset>
    </li>
  );
}
