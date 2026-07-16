import { useTranslation } from "react-i18next";
import { useSettings } from "@/hooks/useSettings";
import { DefaultAppSection } from "./DefaultAppSection";
import { Toggle } from "./Toggle";
import { UpdatesSection } from "./UpdatesSection";

export function BehaviorTab() {
  const { t } = useTranslation("settings");
  const { settings, updateSettings } = useSettings();
  const { behavior } = settings;

  return (
    <>
      <div className="settings-section">
        <div className="settings-section-title">{t("behavior.fileHandling.title")}</div>
        <div className="settings-row">
          <div>
            <span className="settings-label">{t("behavior.autoReload.label")}</span>
            <div className="settings-description">{t("behavior.autoReload.description")}</div>
          </div>
          <Toggle
            checked={behavior.autoReload}
            onChange={(v) => updateSettings("behavior.autoReload", v)}
          />
        </div>

        <div className="settings-row">
          <div>
            <span className="settings-label">{t("behavior.reopenLastFile.label")}</span>
            <div className="settings-description">{t("behavior.reopenLastFile.description")}</div>
          </div>
          <Toggle
            checked={behavior.reopenLastFile}
            onChange={(v) => updateSettings("behavior.reopenLastFile", v)}
          />
        </div>

        <div className="settings-row">
          <div>
            <span className="settings-label">{t("behavior.confirmExternalLinks.label")}</span>
            <div className="settings-description">
              {t("behavior.confirmExternalLinks.description")}
            </div>
          </div>
          <Toggle
            checked={behavior.confirmExternalLinks}
            onChange={(v) => updateSettings("behavior.confirmExternalLinks", v)}
          />
        </div>
      </div>

      <DefaultAppSection />

      <UpdatesSection />

      {behavior.recentFiles.length > 0 && (
        <div className="settings-section">
          <div className="settings-section-title">{t("behavior.recentFiles.title")}</div>
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
            {t("behavior.recentFiles.clear")}
          </button>
        </div>
      )}
    </>
  );
}
