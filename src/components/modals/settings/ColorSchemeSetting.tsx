import { useTranslation } from "react-i18next";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useSettings } from "@/hooks/useSettings";
import { DEFAULT_COLOR_SCHEME } from "@/lib/colorSchemeStatus";
import { ColorSchemeNote } from "./ColorSchemeNote";

interface ColorSchemeSettingProps {
  onOpenPlugins: () => void;
}

/** Picks the app's palette from the schemes plugins offer, and explains a missing one. */
export function ColorSchemeSetting({ onOpenPlugins }: ColorSchemeSettingProps) {
  const { t } = useTranslation("settings");
  const { updateSettings } = useSettings();
  const { saved, status, schemes } = useColorScheme();

  const handleChange = (key: string) => {
    const scheme = schemes.find((entry) => entry.key === key);
    const next = scheme ? { id: scheme.key, label: scheme.label } : DEFAULT_COLOR_SCHEME;
    updateSettings("appearance.colorScheme", next);
  };

  return (
    <>
      <div className="settings-row">
        <span className="settings-label">{t("appearance.colorScheme.label")}</span>
        <select
          className="settings-select"
          aria-label={t("appearance.colorScheme.label")}
          value={saved.id}
          onChange={(e) => handleChange(e.target.value)}
        >
          <option value={DEFAULT_COLOR_SCHEME.id}>{t("appearance.colorScheme.default")}</option>
          {schemes.map((scheme) => (
            <option key={scheme.key} value={scheme.key}>
              {scheme.label}
            </option>
          ))}
          {/* The saved scheme stays selected while no plugin offers it, rather than claiming Default. */}
          {status.kind === "pending" && (
            <option value={saved.id} disabled>
              {saved.label}
            </option>
          )}
          {status.kind === "missing" && (
            <option value={saved.id} disabled>
              {t("appearance.colorScheme.unavailable", { name: saved.label })}
            </option>
          )}
        </select>
      </div>
      {status.kind === "missing" && (
        <ColorSchemeNote
          scheme={saved.label}
          reason={status.reason}
          provider={status.provider}
          onOpenPlugins={onOpenPlugins}
        />
      )}
      <div className="settings-description">
        {t("appearance.colorScheme.more")}{" "}
        <button type="button" className="settings-link" onClick={onOpenPlugins}>
          {t("appearance.colorScheme.manage")}
        </button>
      </div>
    </>
  );
}
