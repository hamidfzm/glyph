import { useTranslation } from "react-i18next";
import { useAgentWriteTools } from "@/hooks/useAgentWriteTools";
import { useSettings } from "@/hooks/useSettings";
import { Toggle } from "./Toggle";

/** What an agent connected through `glyph mcp` may change: one toggle per
 *  tool, each off until turned on. Reading needs no toggle. */
export function AgentToolsSection() {
  const { t } = useTranslation("settings");
  const { settings, updateSettings } = useSettings();
  const tools = useAgentWriteTools();
  const enabled = settings.ai.agentWriteTools;

  if (tools.length === 0) return null;

  const handleToggle = (tool: string, on: boolean) => {
    const others = enabled.filter((name) => name !== tool);
    updateSettings("ai.agentWriteTools", on ? [...others, tool] : others);
  };

  return (
    <div className="settings-section">
      <div className="settings-section-title">{t("ai.agentTools.title")}</div>
      <div className="settings-description">{t("ai.agentTools.description")}</div>
      {tools.map((tool) => (
        <div className="settings-row" key={tool}>
          <div>
            <span className="settings-label">{t(`ai.agentTools.tools.${tool}.label`)}</span>
            <div className="settings-description">
              {t(`ai.agentTools.tools.${tool}.description`)}
            </div>
          </div>
          <Toggle
            checked={enabled.includes(tool)}
            onChange={(on) => handleToggle(tool, on)}
            label={t(`ai.agentTools.tools.${tool}.label`)}
          />
        </div>
      ))}
    </div>
  );
}
