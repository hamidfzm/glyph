import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOllamaModels } from "@/hooks/useOllamaModels";
import { useSettings } from "@/hooks/useSettings";
import { type KeyedProvider, setAiKey } from "@/lib/aiKeys";
import { AIModelField } from "./AIModelField";

// Keychain writes are debounced so typing a key doesn't hit the OS credential
// manager on every keystroke (Linux keyrings may prompt per write).
const KEY_SAVE_DEBOUNCE = 600;

/** Which AI backend to use and how to reach it: provider, credentials or
 *  server URL, and the model. */
export function AIProviderSection() {
  const { t } = useTranslation("settings");
  const { settings, updateSettings } = useSettings();
  const { ai } = settings;
  const ollama = useOllamaModels(ai.ollamaUrl, ai.provider === "ollama");

  // Keys live in memory (settings.ai.apiKeys) for the session and in the OS
  // keychain for persistence; this writes through to the keychain. The timer
  // deliberately survives unmount so a quickly-closed modal still saves.
  const [keychainError, setKeychainError] = useState(false);
  const keySaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const handleKeyChange = useCallback(
    (provider: KeyedProvider, value: string) => {
      updateSettings("ai.apiKeys", { ...ai.apiKeys, [provider]: value });
      if (keySaveTimer.current) clearTimeout(keySaveTimer.current);
      keySaveTimer.current = setTimeout(() => {
        setAiKey(provider, value)
          .then(() => setKeychainError(false))
          .catch((err) => {
            console.error("Failed to store the API key in the keychain:", err);
            setKeychainError(true);
          });
      }, KEY_SAVE_DEBOUNCE);
    },
    [ai.apiKeys, updateSettings],
  );

  return (
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
        <>
          <div className="settings-row">
            <div>
              <span className="settings-label">{t("ai.apiKey.label")}</span>
              <div className="settings-description">{t("ai.apiKey.description")}</div>
            </div>
            <input
              className="settings-input"
              type="password"
              value={ai.apiKeys[ai.provider] ?? ""}
              onChange={(e) => handleKeyChange(ai.provider as KeyedProvider, e.target.value)}
              placeholder={ai.provider === "claude" ? "sk-ant-..." : "sk-..."}
            />
          </div>
          {keychainError && (
            <div className="settings-description" style={{ marginTop: 4 }}>
              {t("ai.apiKey.keychainError")}
            </div>
          )}
        </>
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

      {ai.provider !== "none" && <AIModelField ollama={ollama} />}
    </div>
  );
}
