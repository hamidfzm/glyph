import { useTranslation } from "react-i18next";
import { presenceStatusKey } from "@/lib/secretSlots";

interface SyncTokenFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Whether a token is in the keychain: `undefined` while the check runs,
   *  `null` when it failed or no folder is open. Drives the placeholder and
   *  the Remove button. */
  tokenStored: boolean | null | undefined;
  /** Absent where nothing can be stored yet, which hides the keychain row. */
  onRemove?: () => void;
  busy: boolean;
  /** Where the token is kept, in the user's words. */
  note: string;
}

/** The access token field of a sync form, with its keychain status. */
export function SyncTokenField({
  value,
  onChange,
  tokenStored,
  onRemove,
  busy,
  note,
}: SyncTokenFieldProps) {
  const { t } = useTranslation("sync");
  // The keychain status and Remove wording are shared with the app-wide Saved
  // Secrets list, so they come from the settings bundle rather than being
  // duplicated into every locale's sync bundle.
  const { t: ts } = useTranslation("settings");

  return (
    <label className="settings-field">
      <span className="settings-field-label">
        {t("token.label")} <span className="settings-field-hint">{t("token.hint")}</span>
      </span>
      <input
        type="password"
        className="settings-input"
        placeholder={tokenStored ? t("token.placeholderSaved") : t("token.placeholderNew")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
      />
      <span className="settings-field-hint">{note}</span>
      {/* A sync token's audit row lives with its form rather than in the
          app-wide Saved Secrets list. Presence only: the stored value is
          never read back. */}
      {onRemove && (
        <div className="settings-secret-actions">
          <span className="settings-field-hint">{ts(presenceStatusKey(tokenStored))}</span>
          <button
            type="button"
            className="settings-danger-btn"
            aria-label={ts("secrets.removeSlot", { slot: t("token.label") })}
            disabled={busy || tokenStored === undefined || tokenStored === false}
            onClick={onRemove}
          >
            {ts("secrets.remove")}
          </button>
        </div>
      )}
    </label>
  );
}
