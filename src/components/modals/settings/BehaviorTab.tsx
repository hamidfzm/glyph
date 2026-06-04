import { useSettings } from "@/hooks/useSettings";
import { Toggle } from "./controls";
import { UpdatesSection } from "./UpdatesSection";

export function BehaviorTab() {
  const { settings, updateSettings } = useSettings();
  const { behavior } = settings;

  return (
    <>
      <div className="settings-section">
        <div className="settings-section-title">File Handling</div>
        <div className="settings-row">
          <div>
            <span className="settings-label">Auto-reload</span>
            <div className="settings-description">Reload file when changed on disk</div>
          </div>
          <Toggle
            checked={behavior.autoReload}
            onChange={(v) => updateSettings("behavior.autoReload", v)}
          />
        </div>

        <div className="settings-row">
          <div>
            <span className="settings-label">Reopen Last File</span>
            <div className="settings-description">Open the last viewed file on startup</div>
          </div>
          <Toggle
            checked={behavior.reopenLastFile}
            onChange={(v) => updateSettings("behavior.reopenLastFile", v)}
          />
        </div>

        <div className="settings-row">
          <div>
            <span className="settings-label">Confirm External Links</span>
            <div className="settings-description">Ask before opening links in browser</div>
          </div>
          <Toggle
            checked={behavior.confirmExternalLinks}
            onChange={(v) => updateSettings("behavior.confirmExternalLinks", v)}
          />
        </div>
      </div>

      <UpdatesSection />

      {behavior.recentFiles.length > 0 && (
        <div className="settings-section">
          <div className="settings-section-title">Recent Files</div>
          {behavior.recentFiles.map((file) => (
            <div
              key={file}
              style={{ fontSize: 12, color: "var(--color-text-secondary)", padding: "3px 0" }}
            >
              {file}
            </div>
          ))}
          <button
            type="button"
            className="settings-reset-btn"
            style={{ marginTop: 8 }}
            onClick={() => updateSettings("behavior.recentFiles", [])}
          >
            Clear Recent Files
          </button>
        </div>
      )}
    </>
  );
}
