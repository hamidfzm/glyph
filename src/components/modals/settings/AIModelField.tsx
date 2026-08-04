import { useTranslation } from "react-i18next";
import type { useOllamaModels } from "@/hooks/useOllamaModels";
import { useSettings } from "@/hooks/useSettings";
import { MODEL_SUGGESTIONS } from "@/lib/settingsDisplay";

interface AIModelFieldProps {
  ollama: ReturnType<typeof useOllamaModels>;
}

/** The model row. With a reachable Ollama server it is a dropdown of what is
 *  actually installed (anything else cannot run anyway); otherwise, and for the
 *  other providers, a free-text input with suggestions. */
export function AIModelField({ ollama }: AIModelFieldProps) {
  const { t } = useTranslation("settings");
  const { settings, updateSettings } = useSettings();
  const { ai } = settings;

  const ollamaListReady = ollama.status === "ok" && ollama.models.length > 0;
  const suggestions = MODEL_SUGGESTIONS[ai.provider];

  return (
    <div className="settings-row">
      <span className="settings-label">{t("ai.model.label")}</span>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
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
        {/* Connection feedback so a wrong URL or missing OLLAMA_ORIGINS is
            visible right here instead of failing silently. */}
        {ai.provider === "ollama" && ollama.status !== "idle" && (
          <div className="settings-description" data-ollama-status={ollama.status} role="status">
            {ollama.status === "loading" && t("ai.model.status.checking")}
            {ollama.status === "ok" && t("ai.model.status.ok", { count: ollama.models.length })}
            {ollama.status === "error" && t("ai.model.status.error")}
          </div>
        )}
      </div>
    </div>
  );
}
