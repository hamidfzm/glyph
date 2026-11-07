import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SyncConfigForm } from "@/components/modals/sync/SyncConfigForm";
import type { ConnectRequest } from "@/lib/settingsSyncCommands";
import type { CommitAuthorHint } from "@/lib/sync";
import { connectRequestFromForm, EMPTY_FORM, type FormState } from "@/lib/syncSettingsForm";

interface SettingsSyncSetupProps {
  defaultAuthor: CommitAuthorHint | null;
  busy: boolean;
  onConnect: (request: ConnectRequest) => void;
}

/** The form that connects this machine to a settings repo. */
export function SettingsSyncSetup({ defaultAuthor, busy, onConnect }: SettingsSyncSetupProps) {
  const { t } = useTranslation("sync");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <>
      <SyncConfigForm
        variant="settings"
        form={form}
        onChange={update}
        tokenStored={false}
        busy={busy}
        defaultAuthorName={defaultAuthor?.name}
        defaultAuthorEmail={defaultAuthor?.email}
      />
      <div className="settings-actions">
        <button
          type="button"
          className="settings-primary-btn"
          onClick={() => onConnect(connectRequestFromForm(form))}
          disabled={busy || !form.remoteUrl.trim()}
        >
          {t("settingsRepo.connect")}
        </button>
      </div>
    </>
  );
}
