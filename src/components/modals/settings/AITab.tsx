import { useSettings } from "@/hooks/useSettings";
import { MODEL_SUGGESTIONS } from "@/lib/settings";

export function AITab() {
  const { settings, updateSettings } = useSettings();
  const { ai } = settings;

  const models = ai.provider !== "none" ? (MODEL_SUGGESTIONS[ai.provider] ?? []) : [];

  return (
    <>
      <div className="settings-section">
        <div className="settings-section-title">AI Provider</div>
        <div className="settings-row">
          <span className="settings-label">Provider</span>
          <select
            className="settings-select"
            value={ai.provider}
            onChange={(e) => updateSettings("ai.provider", e.target.value)}
          >
            <option value="none">None</option>
            <option value="claude">Claude (Anthropic)</option>
            <option value="openai">OpenAI</option>
            <option value="ollama">Ollama (Local)</option>
          </select>
        </div>

        {(ai.provider === "claude" || ai.provider === "openai") && (
          <div className="settings-row">
            <span className="settings-label">API Key</span>
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
              <span className="settings-label">Ollama URL</span>
              <div className="settings-description">Requires OLLAMA_ORIGINS=* for CORS</div>
            </div>
            <input
              className="settings-input"
              type="text"
              value={ai.ollamaUrl}
              onChange={(e) => updateSettings("ai.ollamaUrl", e.target.value)}
              placeholder="http://localhost:11434"
            />
          </div>
        )}

        {ai.provider !== "none" && (
          <div className="settings-row">
            <span className="settings-label">Model</span>
            <div
              style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}
            >
              <input
                className="settings-input"
                type="text"
                value={ai.model}
                onChange={(e) => updateSettings("ai.model", e.target.value)}
                placeholder="Select or type model name"
                list="model-suggestions"
              />
              {models.length > 0 && (
                <datalist id="model-suggestions">
                  {models.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="settings-section">
        <div className="settings-section-title">Text-to-Speech</div>
        <div className="settings-row">
          <span className="settings-label">Voice</span>
          <input
            className="settings-input"
            type="text"
            value={ai.ttsVoice}
            onChange={(e) => updateSettings("ai.ttsVoice", e.target.value)}
            placeholder="Default system voice"
          />
        </div>

        <div className="settings-row">
          <span className="settings-label">Speed</span>
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
