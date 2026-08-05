import { useTranslation } from "react-i18next";
import { useSettings } from "@/hooks/useSettings";
import { useSystemVoices } from "@/hooks/useSystemVoices";

/** Read-aloud settings: which system voice speaks and how fast. */
export function TtsSection() {
  const { t } = useTranslation("settings");
  const { settings, updateSettings } = useSettings();
  const { ai } = settings;
  const voices = useSystemVoices();

  return (
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
  );
}
