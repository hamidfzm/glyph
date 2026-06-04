import { useSettings } from "@/hooks/useSettings";
import { Segmented, Toggle } from "./controls";

export function PrintTab() {
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
