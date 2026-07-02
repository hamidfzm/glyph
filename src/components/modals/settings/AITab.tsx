import { useTranslation } from "react-i18next";
import { useOllamaModels } from "@/hooks/useOllamaModels";
import { useSettings } from "@/hooks/useSettings";
import { useSystemVoices } from "@/hooks/useSystemVoices";
import { MODEL_SUGGESTIONS } from "@/lib/settings";

export function AITab() {
  const { t } = useTranslation("settings");
  const { settings, updateSettings } = useSettings();
  const { ai } = settings;

  const ollama = useOllamaModels(ai.ollamaUrl, ai.provider === "ollama");
  const voices = useSystemVoices();

  // With a reachable Ollama server the model field is a dropdown of what is
  // actually installed (anything else cannot run anyway). Otherwise, and for
  // the other providers, it stays a free-text input with suggestions.
  const ollamaListReady = ollama.status === "ok" && ollama.models.length > 0;
  const suggestions =
    ai.provider === "none" ? [] : (MODEL_SUGGESTIONS[ai.provider] ?? MODEL_SUGGESTIONS.ollama);

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
              {ollamaListReady ? (
                <select
                  className="settings-select"
                  value={ai.model}
                  onChange={(e) => updateSettings("ai.model", e.target.value)}
                >
                  {!ai.model && <option value="">{t("ai.model.placeholder")}</option>}
                  {ai.model && !ollama.models.includes(ai.model) && (
                    <option value={ai.model}>{ai.model}</option>
                  )}
                  {ollama.models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              ) : (
                <>
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
                    {suggestions.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </>
              )}
              {/* Connection feedback so a wrong URL or missing OLLAMA_ORIGINS
                  is visible right here instead of failing silently. */}
              {ai.provider === "ollama" && ollama.status !== "idle" && (
                <div
                  className="settings-description"
                  data-ollama-status={ollama.status}
                  role="status"
                >
                  {ollama.status === "loading" && t("ai.model.status.checking")}
                  {ollama.status === "ok" &&
                    t("ai.model.status.ok", { count: ollama.models.length })}
                  {ollama.status === "error" && t("ai.model.status.error")}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="settings-section">
        <div className="settings-section-title">{t("ai.tts.title")}</div>
        <div className="settings-row">
          <span className="settings-label">{t("ai.voice.label")}</span>
          {voices.length > 0 ? (
            <select
              className="settings-select"
              value={ai.ttsVoice}
              onChange={(e) => updateSettings("ai.ttsVoice", e.target.value)}
            >
              <option value="">{t("ai.voice.placeholder")}</option>
              {ai.ttsVoice && !voices.some((v) => v.name === ai.ttsVoice) && (
                <option value={ai.ttsVoice}>{ai.ttsVoice}</option>
              )}
              {voices.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
          ) : (
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
          )}
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
