import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "@/hooks/useSettings";
import { checkForUpdate } from "@/lib/updateCheck";
import { Toggle } from "./Toggle";

// Outcome of a manual "Check Now": idle before the first click, then the
// resolved state of the most recent check.
type ManualStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available"; version: string; url: string }
  | { kind: "current" }
  | { kind: "error" };

export function UpdatesSection() {
  const { t } = useTranslation("settings");
  const { settings, updateSettings } = useSettings();
  const { behavior } = settings;
  const [status, setStatus] = useState<ManualStatus>({ kind: "idle" });

  const handleCheck = useCallback(async () => {
    setStatus({ kind: "checking" });
    const result = await checkForUpdate();
    if (result.status === "available") {
      setStatus({ kind: "available", version: result.latestVersion, url: result.url });
    } else if (result.status === "current") {
      setStatus({ kind: "current" });
    } else {
      setStatus({ kind: "error" });
    }
  }, []);

  return (
    <div className="settings-section">
      <div className="settings-section-title">{t("updates.title")}</div>
      <div className="settings-row">
        <div>
          <span className="settings-label">{t("updates.check.label")}</span>
          <div className="settings-description">{t("updates.check.description")}</div>
        </div>
        <Toggle
          checked={behavior.checkForUpdates}
          onChange={(v) => updateSettings("behavior.checkForUpdates", v)}
        />
      </div>

      <button
        type="button"
        className="settings-reset-btn"
        style={{ marginTop: 8 }}
        onClick={handleCheck}
        disabled={status.kind === "checking"}
      >
        {status.kind === "checking" ? t("updates.checking") : t("updates.checkNow")}
      </button>

      {status.kind === "current" && (
        <div className="settings-description" style={{ marginTop: 8 }}>
          {t("updates.current")}
        </div>
      )}
      {status.kind === "error" && (
        <div className="settings-description" style={{ marginTop: 8 }}>
          {t("updates.error")}
        </div>
      )}
      {status.kind === "available" && (
        <div className="settings-description" style={{ marginTop: 8 }}>
          {t("updates.available", { version: status.version })}{" "}
          <button
            type="button"
            onClick={() => void openUrl(status.url)}
            style={{ color: "var(--color-accent)", textDecoration: "underline", cursor: "pointer" }}
          >
            {t("updates.download")}
          </button>
        </div>
      )}
    </div>
  );
}
