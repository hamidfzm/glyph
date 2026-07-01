import { useTranslation } from "react-i18next";
import { useOllamaModels } from "@/hooks/useOllamaModels";
import { useSettings } from "@/hooks/useSettings";
import { MODEL_SUGGESTIONS } from "@/lib/settings";

export function AITab() {
  const { t } = useTranslation("settings");
  const { settings, updateSettings } = useSettings();
  const { ai } = settings;

  // For Ollama the suggestions are the models actually installed on the local
  // server (falling back to the built-ins when it's unreachable); the other
  // providers keep their static lists.
  const ollamaModels = useOllamaModels(ai.ollamaUrl, ai.provider === "ollama");
  const models =
    ai.provider === "none"
      ? []
      : ai.provider === "ollama"
        ? ollamaModels
        : MODEL_SUGGESTIONS[ai.provider];

  return (
    <>
      <div className="settings-section">
        <div className="settings-section-title">{t("ai.provider.title")}</div>
        <div className="settings-row">
          <span className="settings-label">{t("ai.provider.label")}</span>
          <select
            className="settings-select"
            value={ai.provider}
            onChange={(e) => updateSettings("ai.provider", e.target.value)}
          >
            <option value="none">{t("ai.provider.none")}</option>
            <option value="claude">{t("ai.provider.claude")}</option>
            <option value="openai">{t("ai.provider.openai")}</option>
            <option value="ollama">{t("ai.provider.ollama")}</option>
          </select>
        </div>

        {(ai.provider === "claude" || ai.provider === "openai") && (
          <div className="settings-row">
            <span className="settings-label">{t("ai.apiKey.label")}</span>
            <input
              className="settings-input"
              type="password"
              value={ai.apiKeys[ai.provider] ?? ""}
              onChange={(e) =>
                updateSettings("ai.apiKeys", { ...ai.apiKeys, [ai.provider]: e.target.value })
              }
              placeholder={ai.provider === "claude" ? "sk-ant-..." : "sk-..."}
            />
          </div>
        )}

        {ai.provider === "ollama" && (
          <div className="settings-row">
            <div>
              <span className="settings-label">{t("ai.ollamaUrl.label")}</span>
              <div className="settings-description">{t("ai.ollamaUrl.description")}</div>
            </div>
            <input
              className="settings-input"
              type="text"
              value={ai.ollamaUrl}
              onChange={(e) => updateSettings("ai.ollamaUrl", e.target.value)}
              placeholder="http://localhost:11434"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
            />
          </div>
        )}

        {ai.provider !== "none" && (
          <div className="settings-row">
            <span className="settings-label">{t("ai.model.label")}</span>
            <div
              style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}
            >
              <input
                className="settings-input"
                type="text"
                value={ai.model}
                onChange={(e) => updateSettings("ai.model", e.target.value)}
                placeholder={t("ai.model.placeholder")}
                list="model-suggestions"
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
              />
              <datalist id="model-suggestions">
                {models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </div>
          </div>
        )}
      </div>

      <div className="settings-section">
        <div className="settings-section-title">{t("ai.tts.title")}</div>
        <div className="settings-row">
          <span className="settings-label">{t("ai.voice.label")}</span>
          <input
            className="settings-input"
            type="text"
            value={ai.ttsVoice}
            onChange={(e) => updateSettings("ai.ttsVoice", e.target.value)}
            placeholder={t("ai.voice.placeholder")}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
          />
        </div>

        <div className="settings-row">
          <span className="settings-label">{t("ai.speed.label")}</span>
          <div className="settings-range">
            <input
              type="range"
              min={0.5}
              max={2.0}
              step={0.1}
              value={ai.ttsSpeed}
              onChange={(e) => updateSettings("ai.ttsSpeed", Number(e.target.value))}
            />
            <span className="settings-range-value">{ai.ttsSpeed.toFixed(1)}x</span>
          </div>
        </div>
      </div>
    </>
  );
}
