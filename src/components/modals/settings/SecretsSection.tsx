import { useTranslation } from "react-i18next";
import { useSecretSlots } from "@/hooks/useSecretSlots";
import { slotLabelKey } from "@/lib/secretSlots";
import { SecretRow } from "./SecretRow";

/**
 * Audit view over the secrets Glyph keeps in the OS keychain. It reports only
 * whether each slot is filled: values are never fetched, rendered, or logged.
 */
export function SecretsSection() {
  const { t } = useTranslation("settings");
  const { slots, presence, workspacePath, busySlotId, errorKey, remove, save } = useSecretSlots();

  return (
    <div className="settings-section">
      <div className="settings-section-title">{t("secrets.title")}</div>
      <div className="settings-description">{t("secrets.description")}</div>

      {slots.map((slot) => (
        <SecretRow
          key={slot.id}
          label={t(slotLabelKey(slot))}
          isSet={presence[slot.id] ?? null}
          unavailableHint={
            slot.kind === "sync" && !workspacePath ? t("secrets.noWorkspace") : undefined
          }
          busy={busySlotId !== null}
          onRemove={() => remove(slot)}
          onSave={(value) => save(slot, value)}
        />
      ))}

      {errorKey && <div className="settings-secret-error">{t(errorKey)}</div>}
    </div>
  );
}
