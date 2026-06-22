import { useTranslation } from "react-i18next";
import { useSettings } from "@/hooks/useSettings";
import { Segmented } from "./Segmented";
import { Toggle } from "./Toggle";

export function PrintTab() {
  const { t } = useTranslation("settings");
  const { settings, updateSettings } = useSettings();
  const { print } = settings;

  return (
    <div className="settings-section">
      <div className="settings-section-title">{t("print.title")}</div>
      <div className="settings-row">
        <div>
          <span className="settings-label">{t("print.pageBreaks.label")}</span>
          <div className="settings-description">{t("print.pageBreaks.description")}</div>
        </div>
        <Segmented
          value={print.pageBreakLevel}
          options={[
            { value: "none", label: t("print.pageBreaks.none") },
            { value: "h1", label: t("print.pageBreaks.h1") },
            { value: "h2", label: t("print.pageBreaks.h2") },
          ]}
          onChange={(v) => updateSettings("print.pageBreakLevel", v)}
        />
      </div>

      <div className="settings-row">
        <div>
          <span className="settings-label">{t("print.toc.label")}</span>
          <div className="settings-description">{t("print.toc.description")}</div>
        </div>
        <Toggle
          checked={print.includeToc}
          onChange={(v) => updateSettings("print.includeToc", v)}
        />
      </div>

      <div className="settings-row">
        <div>
          <span className="settings-label">{t("print.backgrounds.label")}</span>
          <div className="settings-description">{t("print.backgrounds.description")}</div>
        </div>
        <Toggle
          checked={print.includeBackground}
          onChange={(v) => updateSettings("print.includeBackground", v)}
        />
      </div>
    </div>
  );
}
