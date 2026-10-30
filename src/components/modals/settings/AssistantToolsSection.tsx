import { useTranslation } from "react-i18next";
import { useSettings } from "@/hooks/useSettings";
import { assistantToolsOn } from "@/lib/ai/toolSupport";
import { Toggle } from "./Toggle";

/** Whether the chat panel's assistant may read the window's notes through the
 *  vault tools, set per provider, since what it reads goes to that provider. */
export function AssistantToolsSection() {
  const { t } = useTranslation("settings");
  const { settings, updateSettings } = useSettings();
  const { provider } = settings.ai;
  if (provider === "none") return null;

  const destination =
    provider === "ollama"
      ? t("ai.assistantTools.local")
      : t("ai.assistantTools.cloud", { provider: t(`ai.provider.${provider}`) });

  return (
    <div className="settings-section">
      <div className="settings-section-title">{t("ai.assistantTools.title")}</div>
      <div className="settings-description">{t("ai.assistantTools.description")}</div>
      <div className="settings-row">
        <div>
          <span className="settings-label">{t("ai.assistantTools.label")}</span>
          <div className="settings-description">{destination}</div>
        </div>
        <Toggle
          checked={assistantToolsOn(settings.ai, provider)}
          onChange={(on) => updateSettings(`ai.assistantTools.${provider}`, on)}
          label={t("ai.assistantTools.label")}
        />
      </div>
    </div>
  );
}
