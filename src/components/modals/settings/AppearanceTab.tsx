import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { useSettings } from "@/hooks/useSettings";
import { LanguageSetting } from "./LanguageSetting";
import { Segmented } from "./Segmented";
import { Toggle } from "./Toggle";

// Create custom.css if needed, then show it in the file manager so the user
// can open it in their editor of choice.
async function handleEditCustomCss() {
  try {
    const path = await invoke<string>("ensure_custom_css");
    await revealItemInDir(path);
  } catch (err) {
    console.error("Failed to open custom.css:", err);
  }
}

export function AppearanceTab() {
  const { t } = useTranslation("settings");
  const { settings, updateSettings } = useSettings();
  const { appearance } = settings;

  return (
    <>
      <LanguageSetting />

      <div className="settings-section">
        <div className="settings-section-title">{t("appearance.theme.title")}</div>
        <div className="settings-row">
          <span className="settings-label">{t("appearance.theme.label")}</span>
          <Segmented
            value={appearance.theme}
            options={[
              { value: "system", label: t("appearance.theme.system") },
              { value: "light", label: t("appearance.theme.light") },
              { value: "dark", label: t("appearance.theme.dark") },
            ]}
            onChange={(v) => updateSettings("appearance.theme", v)}
          />
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">{t("appearance.typography.title")}</div>
        <div className="settings-row">
          <span className="settings-label">{t("appearance.fontFamily.label")}</span>
          <select
            className="settings-select"
            value={appearance.fontFamily}
            onChange={(e) => updateSettings("appearance.fontFamily", e.target.value)}
          >
            <option value="system">{t("appearance.fontFamily.system")}</option>
            <option value="serif">{t("appearance.fontFamily.serif")}</option>
            <option value="sans">{t("appearance.fontFamily.sans")}</option>
            <option value="mono">{t("appearance.fontFamily.mono")}</option>
            <option value="custom">{t("appearance.fontFamily.custom")}</option>
          </select>
        </div>

        {appearance.fontFamily === "custom" && (
          <div className="settings-row">
            <span className="settings-label">{t("appearance.customFont.label")}</span>
            <input
              className="settings-input"
              type="text"
              value={appearance.customFont}
              onChange={(e) => updateSettings("appearance.customFont", e.target.value)}
              placeholder={t("appearance.customFont.placeholder")}
            />
          </div>
        )}

        <div className="settings-row">
          <span className="settings-label">{t("appearance.fontSize.label")}</span>
          <div className="settings-range">
            <input
              type="range"
              min={14}
              max={22}
              step={1}
              value={appearance.fontSize}
              onChange={(e) => updateSettings("appearance.fontSize", Number(e.target.value))}
            />
            <span className="settings-range-value">{appearance.fontSize}px</span>
          </div>
        </div>

        <div className="settings-row">
          <span className="settings-label">{t("appearance.lineHeight.label")}</span>
          <Segmented
            value={appearance.lineHeight}
            options={[
              { value: "compact", label: t("appearance.lineHeight.compact") },
              { value: "normal", label: t("appearance.lineHeight.normal") },
              { value: "relaxed", label: t("appearance.lineHeight.relaxed") },
            ]}
            onChange={(v) => updateSettings("appearance.lineHeight", v)}
          />
        </div>

        <div className="settings-row">
          <span className="settings-label">{t("appearance.contentWidth.label")}</span>
          <Segmented
            value={appearance.contentWidth}
            options={[
              { value: "narrow", label: t("appearance.contentWidth.narrow") },
              { value: "medium", label: t("appearance.contentWidth.medium") },
              { value: "wide", label: t("appearance.contentWidth.wide") },
              { value: "full", label: t("appearance.contentWidth.full") },
            ]}
            onChange={(v) => updateSettings("appearance.contentWidth", v)}
          />
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">{t("appearance.code.title")}</div>
        <div className="settings-row">
          <span className="settings-label">{t("appearance.codeFont.label")}</span>
          <input
            className="settings-input"
            type="text"
            value={appearance.codeFont}
            onChange={(e) => updateSettings("appearance.codeFont", e.target.value)}
            placeholder={t("appearance.codeFont.placeholder")}
          />
        </div>

        <div className="settings-row">
          <span className="settings-label">{t("appearance.codeTheme.label")}</span>
          <select
            className="settings-select"
            value={appearance.codeTheme}
            onChange={(e) => updateSettings("appearance.codeTheme", e.target.value)}
          >
            <option value="glyph">{t("appearance.codeTheme.glyph")}</option>
            <option value="github">{t("appearance.codeTheme.github")}</option>
            <option value="monokai">{t("appearance.codeTheme.monokai")}</option>
            <option value="nord">{t("appearance.codeTheme.nord")}</option>
            <option value="solarized-light">{t("appearance.codeTheme.solarizedLight")}</option>
            <option value="solarized-dark">{t("appearance.codeTheme.solarizedDark")}</option>
          </select>
        </div>

        <div className="settings-row">
          <div>
            <span className="settings-label">{t("appearance.customCss.label")}</span>
            <div className="settings-description">
              {t("appearance.customCss.description")}{" "}
              <button
                type="button"
                className="underline cursor-pointer"
                onClick={() => void handleEditCustomCss()}
              >
                {t("appearance.customCss.edit")}
              </button>
            </div>
          </div>
          <Toggle
            checked={appearance.customCss}
            onChange={(v) => updateSettings("appearance.customCss", v)}
          />
        </div>
      </div>
    </>
  );
}
