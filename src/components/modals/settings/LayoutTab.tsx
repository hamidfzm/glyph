import { Trans, useTranslation } from "react-i18next";
import { useSettings } from "@/hooks/useSettings";
import { SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN } from "@/lib/settings";
import { Segmented } from "./Segmented";
import { Toggle } from "./Toggle";

export function LayoutTab() {
  const { t } = useTranslation("settings");
  const { settings, updateSettings } = useSettings();
  const { layout } = settings;

  return (
    <div className="settings-section">
      <div className="settings-section-title">{t("layout.title")}</div>
      <div className="settings-row">
        <div>
          <span className="settings-label">{t("layout.showFiles.label")}</span>
          <div className="settings-description">
            <Trans t={t} i18nKey="layout.showFiles.description" components={{ kbd: <kbd /> }} />
          </div>
        </div>
        <Toggle
          checked={layout.filesSidebarVisible}
          onChange={(v) => updateSettings("layout.filesSidebarVisible", v)}
        />
      </div>

      <div className="settings-row">
        <div>
          <span className="settings-label">{t("layout.showOutline.label")}</span>
          <div className="settings-description">
            <Trans t={t} i18nKey="layout.showOutline.description" components={{ kbd: <kbd /> }} />
          </div>
        </div>
        <Toggle
          checked={layout.outlineSidebarVisible}
          onChange={(v) => updateSettings("layout.outlineSidebarVisible", v)}
        />
      </div>

      <div className="settings-row">
        <div>
          <span className="settings-label">{t("layout.sidebarLayout.label")}</span>
          <div className="settings-description">
            <Trans t={t} i18nKey="layout.sidebarLayout.description" components={{ b: <b /> }} />
          </div>
        </div>
        <Segmented
          value={layout.sidebarLayout}
          options={[
            { value: "split", label: t("layout.sidebarLayout.split") },
            { value: "combined", label: t("layout.sidebarLayout.combined") },
            { value: "beside", label: t("layout.sidebarLayout.beside") },
          ]}
          onChange={(v) => updateSettings("layout.sidebarLayout", v)}
        />
      </div>

      <div className="settings-row">
        <div>
          <span className="settings-label">{t("layout.swap.label")}</span>
          <div className="settings-description">{t("layout.swap.description")}</div>
        </div>
        <Toggle
          checked={layout.swapSidebarSides}
          onChange={(v) => updateSettings("layout.swapSidebarSides", v)}
        />
      </div>

      <div className="settings-row">
        <span className="settings-label">{t("layout.filesWidth.label")}</span>
        <div className="settings-range">
          <input
            type="range"
            min={SIDEBAR_WIDTH_MIN}
            max={SIDEBAR_WIDTH_MAX}
            step={8}
            value={layout.filesSidebarWidth}
            onChange={(e) => updateSettings("layout.filesSidebarWidth", Number(e.target.value))}
          />
          <span className="settings-range-value">{layout.filesSidebarWidth}px</span>
        </div>
      </div>

      <div className="settings-row">
        <span className="settings-label">{t("layout.outlineWidth.label")}</span>
        <div className="settings-range">
          <input
            type="range"
            min={SIDEBAR_WIDTH_MIN}
            max={SIDEBAR_WIDTH_MAX}
            step={8}
            value={layout.outlineSidebarWidth}
            onChange={(e) => updateSettings("layout.outlineSidebarWidth", Number(e.target.value))}
          />
          <span className="settings-range-value">{layout.outlineSidebarWidth}px</span>
        </div>
      </div>
    </div>
  );
}
