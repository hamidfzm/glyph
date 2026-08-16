import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { presenceStatusKey } from "@/lib/secretSlots";

interface SecretRowProps {
  label: string;
  /** `undefined` while the check runs, `null` when it failed. */
  isSet: boolean | null | undefined;
  busy: boolean;
  onRemove: () => void;
  onSave: (value: string) => void;
}

/**
 * One managed secret slot: whether something is stored, and the actions to
 * replace or remove it. The stored value is never read back into this row, so
 * the entry field always starts empty.
 */
export function SecretRow({ label, isSet, busy, onRemove, onSave }: SecretRowProps) {
  const { t } = useTranslation("settings");
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const disabled = busy || isSet === undefined;

  // Closing always drops what was typed: an unsaved secret must not sit in
  // component state waiting to reappear when the field is reopened.
  const handleClose = useCallback(() => {
    setValue("");
    setEditing(false);
  }, []);

  const handleSave = useCallback(() => {
    onSave(value.trim());
    handleClose();
  }, [onSave, value, handleClose]);

  return (
    <>
      <div className="settings-row">
        <div>
          <span className="settings-label">{label}</span>
          <div className="settings-description">{t(presenceStatusKey(isSet))}</div>
        </div>
        <div className="settings-secret-actions">
          <button
            type="button"
            className="settings-secondary-btn"
            aria-label={t(isSet === false ? "secrets.addSlot" : "secrets.replaceSlot", {
              slot: label,
            })}
            disabled={disabled}
            onClick={() => (editing ? handleClose() : setEditing(true))}
          >
            {/* Unknown presence reads as Replace: it may well be stored. */}
            {isSet === false ? t("secrets.add") : t("secrets.replace")}
          </button>
          <button
            type="button"
            className="settings-danger-btn"
            aria-label={t("secrets.removeSlot", { slot: label })}
            disabled={disabled || isSet === false}
            onClick={onRemove}
          >
            {t("secrets.remove")}
          </button>
        </div>
      </div>

      {editing && (
        <div className="settings-row">
          <input
            className="settings-input"
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t("secrets.placeholder")}
            aria-label={t("secrets.newValue", { slot: label })}
            spellCheck={false}
            autoComplete="off"
          />
          <div className="settings-secret-actions">
            <button
              type="button"
              className="settings-primary-btn"
              disabled={disabled || value.trim().length === 0}
              onClick={handleSave}
            >
              {t("secrets.save")}
            </button>
            <button type="button" className="settings-secondary-btn" onClick={handleClose}>
              {t("secrets.cancel")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
