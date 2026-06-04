import { useSettings } from "@/hooks/useSettings";
import { Toggle } from "./controls";

export function ExperimentalTab() {
  const { settings, updateSettings } = useSettings();
  const { experimental } = settings;

  return (
    <div className="settings-section">
      <div className="settings-section-title">Experimental features</div>
      <div className="settings-row">
        <div>
          <span className="settings-label">Cloud Sync</span>
          <div className="settings-description">
            Per-workspace git-backed sync. Experimental: data loss possible; back up your notes
            elsewhere. Restart Glyph after enabling or disabling so the native menu re-registers.
          </div>
        </div>
        <Toggle
          checked={experimental.cloudSync}
          onChange={(v) => updateSettings("experimental.cloudSync", v)}
        />
      </div>
    </div>
  );
}
