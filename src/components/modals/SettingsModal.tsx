import { useCallback, useEffect, useState } from "react";
import { useSettings } from "@/hooks/useSettings";
import { MODEL_SUGGESTIONS } from "@/lib/settings";

type Tab = "appearance" | "layout" | "behavior" | "ai" | "print";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="settings-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="settings-toggle-track" />
      <span className="settings-toggle-thumb" />
    </label>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="settings-segmented">
      {options.map((opt) => (
        <button
          type="button"
          key={opt.value}
          data-active={value === opt.value}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { resetSettings } = useSettings();
  const [tab, setTab] = useState<Tab>("appearance");

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  if (!open) return null;

  const tabs: { id: Tab; label: string }[] = [
    { id: "appearance", label: "Appearance" },
    { id: "layout", label: "Layout" },
    { id: "behavior", label: "Behavior" },
    { id: "ai", label: "AI" },
    { id: "print", label: "Print" },
  ];

  return (
    <div
      className="settings-overlay"
      onClick={handleBackdropClick}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      role="dialog"
    >
      <div className="settings-modal">
        <div className="settings-header">
          <h2>Settings</h2>
          <button type="button" className="settings-close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path
                d="M3 3l8 8M11 3l-8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <nav className="settings-nav">
          {tabs.map((t) => (
            <button
              type="button"
              key={t.id}
              className="settings-tab"
              data-active={tab === t.id}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="settings-body">
          {tab === "appearance" && <AppearanceTab />}
          {tab === "layout" && <LayoutTab />}
          {tab === "behavior" && <BehaviorTab />}
          {tab === "ai" && <AITab />}
          {tab === "print" && <PrintTab />}
        </div>

        <div className="settings-footer">
          <button type="button" className="settings-reset-btn" onClick={resetSettings}>
            Reset to Defaults
          </button>
          <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
            Changes apply immediately
          </span>
        </div>
      </div>
    </div>
  );
}

function AppearanceTab() {
  const { settings, updateSettings } = useSettings();
  const { appearance } = settings;

  return (
    <>
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

function LayoutTab() {
  const { settings, updateSettings } = useSettings();
  const { layout } = settings;

  return (
    <div className="settings-section">
      <div className="settings-section-title">Sidebars</div>
      <div className="settings-row">
        <div>
          <span className="settings-label">Show Files Sidebar</span>
          <div className="settings-description">
            Workspace file tree (folder tabs only). Toggle with <kbd>Cmd/Ctrl+B</kbd>.
          </div>
        </div>
        <Toggle
          checked={layout.filesSidebarVisible}
          onChange={(v) => updateSettings("layout.filesSidebarVisible", v)}
        />
      </div>

      <div className="settings-row">
        <div>
          <span className="settings-label">Show Outline Sidebar</span>
          <div className="settings-description">
            Document table of contents. Toggle with <kbd>Cmd/Ctrl+\</kbd>.
          </div>
        </div>
        <Toggle
          checked={layout.outlineSidebarVisible}
          onChange={(v) => updateSettings("layout.outlineSidebarVisible", v)}
        />
      </div>

      <div className="settings-row">
        <div>
          <span className="settings-label">Sidebar layout</span>
          <div className="settings-description">
            Folder tabs only. <b>Split</b>: Files and Outline on opposite sides. <b>Combined</b>:
            stacked in one panel. <b>Beside</b>: two adjacent panels on the same side.
          </div>
        </div>
        <Segmented
          value={layout.sidebarLayout}
          options={[
            { value: "split", label: "Split" },
            { value: "combined", label: "Combined" },
            { value: "beside", label: "Beside" },
          ]}
          onChange={(v) => updateSettings("layout.sidebarLayout", v)}
        />
      </div>

      <div className="settings-row">
        <div>
          <span className="settings-label">Swap sidebar sides</span>
          <div className="settings-description">
            Flip which side each panel lives on. Default is Files left / Outline right; on, it
            becomes Files right / Outline left.
          </div>
        </div>
        <Toggle
          checked={layout.swapSidebarSides}
          onChange={(v) => updateSettings("layout.swapSidebarSides", v)}
        />
      </div>

      <div className="settings-row">
        <span className="settings-label">Sidebar Width</span>
        <div className="settings-range">
          <input
            type="range"
            min={160}
            max={320}
            step={8}
            value={layout.sidebarWidth}
            onChange={(e) => updateSettings("layout.sidebarWidth", Number(e.target.value))}
          />
          <span className="settings-range-value">{layout.sidebarWidth}px</span>
        </div>
      </div>
    </div>
  );
}

function BehaviorTab() {
  const { settings, updateSettings } = useSettings();
  const { behavior } = settings;

  return (
    <>
      <div className="settings-section">
        <div className="settings-section-title">File Handling</div>
        <div className="settings-row">
          <div>
            <span className="settings-label">Auto-reload</span>
            <div className="settings-description">Reload file when changed on disk</div>
          </div>
          <Toggle
            checked={behavior.autoReload}
            onChange={(v) => updateSettings("behavior.autoReload", v)}
          />
        </div>

        <div className="settings-row">
          <div>
            <span className="settings-label">Reopen Last File</span>
            <div className="settings-description">Open the last viewed file on startup</div>
          </div>
          <Toggle
            checked={behavior.reopenLastFile}
            onChange={(v) => updateSettings("behavior.reopenLastFile", v)}
          />
        </div>

        <div className="settings-row">
          <div>
            <span className="settings-label">Confirm External Links</span>
            <div className="settings-description">Ask before opening links in browser</div>
          </div>
          <Toggle
            checked={behavior.confirmExternalLinks}
            onChange={(v) => updateSettings("behavior.confirmExternalLinks", v)}
          />
        </div>
      </div>

      {behavior.recentFiles.length > 0 && (
        <div className="settings-section">
          <div className="settings-section-title">Recent Files</div>
          {behavior.recentFiles.map((file) => (
            <div
              key={file}
              style={{ fontSize: 12, color: "var(--color-text-secondary)", padding: "3px 0" }}
            >
              {file}
            </div>
          ))}
          <button
            type="button"
            className="settings-reset-btn"
            style={{ marginTop: 8 }}
            onClick={() => updateSettings("behavior.recentFiles", [])}
          >
            Clear Recent Files
          </button>
        </div>
      )}
    </>
  );
}

function PrintTab() {
  const { settings, updateSettings } = useSettings();
  const { print } = settings;

  return (
    <div className="settings-section">
      <div className="settings-section-title">Print & PDF Export</div>
      <div className="settings-row">
        <div>
          <span className="settings-label">Page Breaks</span>
          <div className="settings-description">Start a new page at heading level</div>
        </div>
        <Segmented
          value={print.pageBreakLevel}
          options={[
            { value: "none", label: "None" },
            { value: "h1", label: "At H1" },
            { value: "h2", label: "At H2" },
          ]}
          onChange={(v) => updateSettings("print.pageBreakLevel", v)}
        />
      </div>

      <div className="settings-row">
        <div>
          <span className="settings-label">Include Table of Contents</span>
          <div className="settings-description">Insert a contents page at the start</div>
        </div>
        <Toggle
          checked={print.includeToc}
          onChange={(v) => updateSettings("print.includeToc", v)}
        />
      </div>

      <div className="settings-row">
        <div>
          <span className="settings-label">Print Backgrounds & Colors</span>
          <div className="settings-description">Preserve theme colors in output</div>
        </div>
        <Toggle
          checked={print.includeBackground}
          onChange={(v) => updateSettings("print.includeBackground", v)}
        />
      </div>
    </div>
  );
}

function AITab() {
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
