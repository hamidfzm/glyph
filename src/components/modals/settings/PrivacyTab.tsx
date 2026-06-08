import { useSettings } from "@/hooks/useSettings";
import { Toggle } from "./Toggle";

export function PrivacyTab() {
  const { settings, updateSettings } = useSettings();
  const { privacy } = settings;

  return (
    <div className="settings-section">
      <div className="settings-section-title">Error Reporting</div>
      <div className="settings-row">
        <div>
          <span className="settings-label">Send crash reports</span>
          <div className="settings-description">
            Off by default. When on, anonymous crash reports (stack traces, OS, and app version) are
            sent to help fix bugs. Your files, file paths, and links are never included. Only active
            in production builds. See SECURITY.md for the full policy.
          </div>
        </div>
        <Toggle
          checked={privacy.errorReporting}
          onChange={(v) => updateSettings("privacy.errorReporting", v)}
        />
      </div>
    </div>
  );
}
