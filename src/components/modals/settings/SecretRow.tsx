import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { presenceStatusKey } from "@/lib/secretSlots";

interface SecretRowProps {
  label: string;
  /** `null` when the check failed or the slot can't be reached right now. */
  isSet: boolean | null;
  /** Why the slot can't be managed, when it can't; also disables the row. */
  unavailableHint?: string;
  busy: boolean;
  onRemove: () => void;
  onSave: (value: string) => void;
}

/**
 * One managed secret slot: whether something is stored, and the actions to
 * replace or remove it. The stored value is never read back into this row, so
 * the entry field always starts empty.
 */
export function SecretRow({
  label,
  isSet,
  unavailableHint,
  busy,
  onRemove,
  onSave,
}: SecretRowProps) {
  const { t } = useTranslation("settings");
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const disabled = busy || unavailableHint !== undefined;

  const handleSave = useCallback(() => {
    onSave(value);
    setValue("");
    setEditing(false);
  }, [onSave, value]);

  const handleCancel = useCallback(() => {
    setValue("");
    setEditing(false);
  }, []);

  return (
    <>
      <div className="settings-row">
        <div>
          <span className="settings-label">{label}</span>
          <div className="settings-description">
            {unavailableHint ?? t(presenceStatusKey(isSet))}
          </div>
        </div>
        <div className="settings-secret-actions">
          <button
            type="button"
            className="settings-secondary-btn"
            disabled={disabled}
            onClick={() => setEditing((prev) => !prev)}
          >
            {/* Unknown presence reads as Replace: it may well be stored. */}
            {isSet === false ? t("secrets.add") : t("secrets.replace")}
          </button>
          <button
            type="button"
            className="settings-danger-btn"
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
              disabled={disabled || value.length === 0}
              onClick={handleSave}
            >
              {t("secrets.save")}
            </button>
            <button type="button" className="settings-secondary-btn" onClick={handleCancel}>
              {t("secrets.cancel")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
