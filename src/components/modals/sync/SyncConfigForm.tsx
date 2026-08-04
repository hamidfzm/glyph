import { useTranslation } from "react-i18next";
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
  /** True once a config is stored, which changes the token placeholder. */
  configured: boolean;
  defaultAuthorName?: string | null;
  defaultAuthorEmail?: string | null;
}

/** The editable fields of the cloud-sync settings modal. */
export function SyncConfigForm({
  form,
  onChange,
  configured,
  defaultAuthorName,
  defaultAuthorEmail,
}: SyncConfigFormProps) {
  const { t } = useTranslation("sync");

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
          placeholder={configured ? t("token.placeholderSaved") : t("token.placeholderNew")}
          value={form.token}
          onChange={(e) => onChange("token", e.target.value)}
          autoComplete="off"
        />
        <span className="settings-field-hint">{t("token.note")}</span>
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
