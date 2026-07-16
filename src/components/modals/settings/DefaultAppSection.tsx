import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { type DefaultAppOutcome, setDefaultMarkdownApp } from "@/lib/defaultApp";

// The canonical place to (re)register Glyph as the default Markdown app, with a
// per-platform result line (silent success on Linux, an opened settings page on
// Windows, or manual guidance on macOS).
export function DefaultAppSection() {
  const { t } = useTranslation("settings");
  const [outcome, setOutcome] = useState<DefaultAppOutcome | "busy" | null>(null);

  const handleSet = useCallback(async () => {
    setOutcome("busy");
    setOutcome(await setDefaultMarkdownApp());
  }, []);

  return (
    <div className="settings-section">
      <div className="settings-section-title">{t("defaultApp.title")}</div>
      <div className="settings-row">
        <div>
          <span className="settings-label">{t("defaultApp.label")}</span>
          <div className="settings-description">{t("defaultApp.description")}</div>
        </div>
      </div>

      <button
        type="button"
        className="settings-reset-btn"
        style={{ marginTop: 8 }}
        onClick={handleSet}
        disabled={outcome === "busy"}
      >
        {outcome === "busy" ? t("defaultApp.working") : t("defaultApp.button")}
      </button>

      {outcome && outcome !== "busy" && (
        <div className="settings-description" style={{ marginTop: 8 }}>
          {t(`defaultApp.outcome.${outcome}`)}
        </div>
      )}
    </div>
  );
}
