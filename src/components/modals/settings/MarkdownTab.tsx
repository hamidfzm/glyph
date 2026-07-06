import { useTranslation } from "react-i18next";
import { useSettings } from "@/hooks/useSettings";
import type { MarkdownSettings } from "@/lib/settings";
import { Toggle } from "./Toggle";

const FEATURES: (keyof MarkdownSettings)[] = ["gfm", "math", "alerts", "emoji", "wikilinks"];

/**
 * Settings → Markdown: toggle the optional syntax extensions. Turning one off
 * removes it from the rendering pipeline, so its raw syntax shows as written.
 */
export function MarkdownTab() {
  const { t } = useTranslation("settings");
  const { settings, updateSettings } = useSettings();
  const { markdown } = settings;

  return (
    <div className="settings-section">
      <div className="settings-section-title">{t("markdown.title")}</div>
      {FEATURES.map((feature) => (
        <div className="settings-row" key={feature}>
          <div>
            <span className="settings-label">{t(`markdown.${feature}.label`)}</span>
            <div className="settings-description">{t(`markdown.${feature}.description`)}</div>
          </div>
          <Toggle
            checked={markdown[feature]}
            onChange={(v) => updateSettings(`markdown.${feature}`, v)}
          />
        </div>
      ))}
    </div>
  );
}
