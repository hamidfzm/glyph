import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { SyncStatusPanel } from "@/components/modals/sync/SyncStatusPanel";
import { SyncTokenField } from "@/components/modals/sync/SyncTokenField";
import type { SettingsRepoConfig } from "@/lib/settingsSync";
import type { StatusReport, SyncResult } from "@/lib/sync";

interface SettingsSyncConnectedProps {
  config: SettingsRepoConfig;
  status: StatusReport | null;
  lastResult: SyncResult | null;
  tokenStored: boolean;
  busy: boolean;
  /** A merge waits for its conflicts to be resolved before the next sync. */
  hasConflicts: boolean;
  onSyncNow: () => void;
  onDisconnect: () => void;
  onSaveToken: (token: string) => void;
  onRemoveToken: () => void;
}

/** A connected settings repo: where it syncs to, its token, and Sync now. */
export function SettingsSyncConnected({
  config,
  status,
  lastResult,
  tokenStored,
  busy,
  hasConflicts,
  onSyncNow,
  onDisconnect,
  onSaveToken,
  onRemoveToken,
}: SettingsSyncConnectedProps) {
  const { t } = useTranslation("sync");
  const [token, setToken] = useState("");
  const typedToken = token.trim();
  // A token only ever goes to an https remote.
  const takesToken = config.remoteUrl.startsWith("https://");

  const handleSaveToken = () => {
    onSaveToken(typedToken);
    setToken("");
  };

  return (
    <>
      <p>
        <Trans
          i18nKey="sync:settingsRepo.connectedTo"
          components={{ strong: <strong /> }}
          values={{ remote: config.remoteUrl, branch: config.branch }}
        />
      </p>
      {takesToken && (
        <SyncTokenField
          value={token}
          onChange={setToken}
          tokenStored={tokenStored}
          onRemove={onRemoveToken}
          busy={busy}
          note={t("settingsRepo.tokenNote")}
        />
      )}
      <div className="settings-actions">
        <button
          type="button"
          className="settings-primary-btn"
          onClick={onSyncNow}
          disabled={busy || hasConflicts}
        >
          {t("syncNow")}
        </button>
        {typedToken && (
          <button
            type="button"
            className="settings-secondary-btn"
            onClick={handleSaveToken}
            disabled={busy}
          >
            {t("settingsRepo.saveToken")}
          </button>
        )}
        <button
          type="button"
          className="settings-danger-btn"
          onClick={onDisconnect}
          disabled={busy}
        >
          {t("settingsRepo.disconnect")}
        </button>
      </div>
      <SyncStatusPanel status={status} lastSync={lastResult} />
    </>
  );
}
