import { useTranslation } from "react-i18next";
import { useSettings } from "@/hooks/useSettings";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { Toggle } from "./Toggle";

/** What an agent connected through `glyph mcp` may change: one toggle per
 *  tool, each off until turned on. Reading needs no toggle. */
export function AgentToolsSection() {
  const { t } = useTranslation("settings");
  const { settings, updateSettings } = useSettings();
  const enabled = settings.ai.agentWriteTools;

  return (
    <div className="settings-section">
      <div className="settings-section-title">{t("ai.agentTools.title")}</div>
      <div className="settings-description">{t("ai.agentTools.description")}</div>
      {Object.keys(DEFAULT_SETTINGS.ai.agentWriteTools).map((tool) => (
        <div className="settings-row" key={tool}>
          <div>
            <span className="settings-label">{t(`ai.agentTools.tools.${tool}.label`)}</span>
            <div className="settings-description">
              {t(`ai.agentTools.tools.${tool}.description`)}
            </div>
          </div>
          <Toggle
            checked={enabled[tool] === true}
            onChange={(on) => updateSettings(`ai.agentWriteTools.${tool}`, on)}
            label={t(`ai.agentTools.tools.${tool}.label`)}
          />
        </div>
      ))}
    </div>
  );
}
