import { useTranslation } from "react-i18next";
import { useSettings } from "@/hooks/useSettings";
import { LOCALES } from "@/lib/locales";

// Language picker for the Appearance tab. "System" follows the OS locale; the
// remaining options are the bundled locales from the registry, labelled by
// their endonym so each is recognisable to its own speakers.
export function LanguageSetting() {
  const { t } = useTranslation("settings");
  const { settings, updateSettings } = useSettings();

  return (
    <div className="settings-section">
      <div className="settings-section-title">{t("language.sectionTitle")}</div>
      <div className="settings-row">
        <span className="settings-label">{t("language.label")}</span>
        <select
          className="settings-select"
          value={settings.appearance.locale}
          onChange={(e) => updateSettings("appearance.locale", e.target.value)}
        >
          <option value="system">{t("language.system")}</option>
          {LOCALES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.nativeName}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
