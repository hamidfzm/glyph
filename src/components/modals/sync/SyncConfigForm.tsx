import { useTranslation } from "react-i18next";
import { presenceStatusKey } from "@/lib/secretSlots";
import type { ConflictPolicy } from "@/lib/sync";
import type { FormState } from "@/lib/syncSettingsForm";

const CONFLICT_POLICIES: { id: ConflictPolicy; labelKey: string; descKey: string }[] = [
  {
    id: "prompt",
    labelKey: "conflictPolicy.prompt.label",
    descKey: "conflictPolicy.prompt.description",
  },
  {
    id: "prefer-remote",
    labelKey: "conflictPolicy.preferRemote.label",
    descKey: "conflictPolicy.preferRemote.description",
  },
  {
    id: "prefer-local",
    labelKey: "conflictPolicy.preferLocal.label",
    descKey: "conflictPolicy.preferLocal.description",
  },
];

interface SyncConfigFormProps {
  form: FormState;
  onChange: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  /** Whether a token is in the keychain: `undefined` while the check runs,
   *  `null` when it failed or no folder is open. Drives the placeholder and
   *  the Remove button. */
  tokenStored: boolean | null | undefined;
  onRemoveToken: () => void;
  busy: boolean;
  defaultAuthorName?: string | null;
  defaultAuthorEmail?: string | null;
}

/** The editable fields of the cloud-sync settings modal. */
export function SyncConfigForm({
  form,
  onChange,
  tokenStored,
  onRemoveToken,
  busy,
  defaultAuthorName,
  defaultAuthorEmail,
}: SyncConfigFormProps) {
  const { t } = useTranslation("sync");
  // The keychain status and Remove wording are shared with the app-wide Saved
  // Secrets list, so they come from the settings bundle rather than being
  // duplicated into every locale's sync bundle.
  const { t: ts } = useTranslation("settings");

  return (
    <>
      <label className="settings-field">
        <span className="settings-field-label">
          {t("remoteUrl.label")} <span className="settings-field-hint">{t("remoteUrl.hint")}</span>
        </span>
        <input
          type="url"
          className="settings-input"
          placeholder={t("remoteUrl.placeholder")}
          value={form.remoteUrl}
          onChange={(e) => onChange("remoteUrl", e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
      </label>

      <label className="settings-field">
        <span className="settings-field-label">{t("branch.label")}</span>
        <input
          type="text"
          className="settings-input"
          placeholder={t("branch.placeholder")}
          value={form.remoteBranch}
          onChange={(e) => onChange("remoteBranch", e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
      </label>

      <fieldset className="settings-field">
        <legend className="settings-field-label">{t("conflictPolicy.legend")}</legend>
        <div className="settings-segmented">
          {CONFLICT_POLICIES.map((p) => (
            <button
              type="button"
              key={p.id}
              className="settings-segmented-option"
              data-active={form.conflictPolicy === p.id}
              onClick={() => onChange("conflictPolicy", p.id)}
              title={t(p.descKey)}
            >
              {t(p.labelKey)}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="settings-field">
        <span className="settings-field-label">{t("authorName.label")}</span>
        <input
          type="text"
          className="settings-input"
          placeholder={defaultAuthorName ?? t("authorName.placeholder")}
          value={form.authorName}
          onChange={(e) => onChange("authorName", e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
      </label>

      <label className="settings-field">
        <span className="settings-field-label">{t("authorEmail.label")}</span>
        <input
          type="email"
          className="settings-input"
          placeholder={defaultAuthorEmail ?? t("authorEmail.placeholder")}
          value={form.authorEmail}
          onChange={(e) => onChange("authorEmail", e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
      </label>

      <label className="settings-field">
        <span className="settings-field-label">
          {t("token.label")} <span className="settings-field-hint">{t("token.hint")}</span>
        </span>
        <input
          type="password"
          className="settings-input"
          placeholder={tokenStored ? t("token.placeholderSaved") : t("token.placeholderNew")}
          value={form.token}
          onChange={(e) => onChange("token", e.target.value)}
          autoComplete="off"
        />
        <span className="settings-field-hint">{t("token.note")}</span>
        {/* The token is per-workspace, so its audit row lives here rather than
            in the app-wide Saved Secrets list. Presence only: the stored value
            is never read back. */}
        <div className="settings-secret-actions">
          <span className="settings-field-hint">{ts(presenceStatusKey(tokenStored))}</span>
          <button
            type="button"
            className="settings-danger-btn"
            aria-label={ts("secrets.removeSlot", { slot: t("token.label") })}
            disabled={busy || tokenStored === undefined || tokenStored === false}
            onClick={onRemoveToken}
          >
            {ts("secrets.remove")}
          </button>
        </div>
      </label>

      <label className="settings-field">
        <span className="settings-field-label">
          {t("commitMessage.label")}{" "}
          <span className="settings-field-hint">{t("commitMessage.hint")}</span>
        </span>
        <input
          type="text"
          className="settings-input"
          placeholder={t("commitMessage.placeholder")}
          value={form.commitMessage}
          onChange={(e) => onChange("commitMessage", e.target.value)}
        />
      </label>
    </>
  );
}
