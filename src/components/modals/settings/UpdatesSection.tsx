import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useState } from "react";
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
      <div className="settings-section-title">Updates</div>
      <div className="settings-row">
        <div>
          <span className="settings-label">Check for updates</span>
          <div className="settings-description">
            On launch, check for a newer release and show a banner when one is available. Only the
            installed version is compared; no files or personal data are sent.
          </div>
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
        {status.kind === "checking" ? "Checking…" : "Check Now"}
      </button>

      {status.kind === "current" && (
        <div className="settings-description" style={{ marginTop: 8 }}>
          You're on the latest version.
        </div>
      )}
      {status.kind === "error" && (
        <div className="settings-description" style={{ marginTop: 8 }}>
          Couldn't check for updates. Try again later.
        </div>
      )}
      {status.kind === "available" && (
        <div className="settings-description" style={{ marginTop: 8 }}>
          Version {status.version} is available.{" "}
          <button
            type="button"
            onClick={() => void openUrl(status.url)}
            style={{ color: "var(--color-accent)", textDecoration: "underline", cursor: "pointer" }}
          >
            Download
          </button>
        </div>
      )}
    </div>
  );
}
