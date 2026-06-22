import { useTranslation } from "react-i18next";
import { useSettings } from "@/hooks/useSettings";
import { Toggle } from "./Toggle";

export function PrivacyTab() {
  const { t } = useTranslation("settings");
  const { settings, updateSettings } = useSettings();
  const { privacy } = settings;

  return (
    <div className="settings-section">
      <div className="settings-section-title">{t("privacy.title")}</div>
      <div className="settings-row">
        <div>
          <span className="settings-label">{t("privacy.crashReports.label")}</span>
          <div className="settings-description">{t("privacy.crashReports.description")}</div>
        </div>
        <Toggle
          checked={privacy.errorReporting}
          onChange={(v) => updateSettings("privacy.errorReporting", v)}
        />
      </div>
    </div>
  );
}
