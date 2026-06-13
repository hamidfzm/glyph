import { useSettings } from "@/hooks/useSettings";
import { LanguageSetting } from "./LanguageSetting";
import { Segmented } from "./Segmented";

export function AppearanceTab() {
  const { settings, updateSettings } = useSettings();
  const { appearance } = settings;

  return (
    <>
      <LanguageSetting />

      <div className="settings-section">
        <div className="settings-section-title">Theme</div>
        <div className="settings-row">
          <span className="settings-label">Color Theme</span>
          <Segmented
            value={appearance.theme}
            options={[
              { value: "system", label: "System" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
            onChange={(v) => updateSettings("appearance.theme", v)}
          />
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">Typography</div>
        <div className="settings-row">
          <span className="settings-label">Font Family</span>
          <select
            className="settings-select"
            value={appearance.fontFamily}
            onChange={(e) => updateSettings("appearance.fontFamily", e.target.value)}
          >
            <option value="system">System Default</option>
            <option value="serif">Serif</option>
            <option value="sans">Sans-serif</option>
            <option value="mono">Monospace</option>
            <option value="custom">Custom</option>
          </select>
        </div>

        {appearance.fontFamily === "custom" && (
          <div className="settings-row">
            <span className="settings-label">Custom Font Name</span>
            <input
              className="settings-input"
              type="text"
              value={appearance.customFont}
              onChange={(e) => updateSettings("appearance.customFont", e.target.value)}
              placeholder="e.g. Inter, Lora"
            />
          </div>
        )}

        <div className="settings-row">
          <span className="settings-label">Font Size</span>
          <div className="settings-range">
            <input
              type="range"
              min={14}
              max={22}
              step={1}
              value={appearance.fontSize}
              onChange={(e) => updateSettings("appearance.fontSize", Number(e.target.value))}
            />
            <span className="settings-range-value">{appearance.fontSize}px</span>
          </div>
        </div>

        <div className="settings-row">
          <span className="settings-label">Line Height</span>
          <Segmented
            value={appearance.lineHeight}
            options={[
              { value: "compact", label: "Compact" },
              { value: "normal", label: "Normal" },
              { value: "relaxed", label: "Relaxed" },
            ]}
            onChange={(v) => updateSettings("appearance.lineHeight", v)}
          />
        </div>

        <div className="settings-row">
          <span className="settings-label">Content Width</span>
          <Segmented
            value={appearance.contentWidth}
            options={[
              { value: "narrow", label: "Narrow" },
              { value: "medium", label: "Medium" },
              { value: "wide", label: "Wide" },
              { value: "full", label: "Full" },
            ]}
            onChange={(v) => updateSettings("appearance.contentWidth", v)}
          />
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">Code</div>
        <div className="settings-row">
          <span className="settings-label">Code Font</span>
          <input
            className="settings-input"
            type="text"
            value={appearance.codeFont}
            onChange={(e) => updateSettings("appearance.codeFont", e.target.value)}
            placeholder="Default (SF Mono, Fira Code...)"
          />
        </div>

        <div className="settings-row">
          <span className="settings-label">Code Theme</span>
          <select
            className="settings-select"
            value={appearance.codeTheme}
            onChange={(e) => updateSettings("appearance.codeTheme", e.target.value)}
          >
            <option value="glyph">Glyph (Default)</option>
            <option value="github">GitHub</option>
            <option value="monokai">Monokai</option>
            <option value="nord">Nord</option>
            <option value="solarized-light">Solarized Light</option>
            <option value="solarized-dark">Solarized Dark</option>
          </select>
        </div>
      </div>
    </>
  );
}
