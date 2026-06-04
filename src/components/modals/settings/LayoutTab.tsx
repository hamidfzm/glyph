import { useSettings } from "@/hooks/useSettings";
import { Segmented, Toggle } from "./controls";

export function LayoutTab() {
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
