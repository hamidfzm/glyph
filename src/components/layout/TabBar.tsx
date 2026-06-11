import { EditModeIcon } from "@/components/icons/EditModeIcon";
import { FolderIcon } from "@/components/icons/FolderIcon";
import { GraphIcon } from "@/components/icons/GraphIcon";
import { SplitModeIcon } from "@/components/icons/SplitModeIcon";
import { TabCloseIcon } from "@/components/icons/TabCloseIcon";
import { ViewModeIcon } from "@/components/icons/ViewModeIcon";
import { useTabsContext } from "@/contexts/TabsContext";
import { activeFileOf, type Tab, tabPathOf } from "@/hooks/useTabs";
import { isCanvasFile } from "@/lib/canvasExtensions";
import { EDITOR_MODE } from "@/lib/settings";

function tabLabel(tab: Tab): string {
  if (tab.kind === "folder" || tab.kind === "graph") {
    const segments = tab.root.split(/[\\/]/).filter(Boolean);
    const name = segments[segments.length - 1] ?? tab.root;
    return tab.kind === "graph" ? `Graph: ${name}` : name;
  }
  return tab.file.metadata?.name ?? "Untitled";
}

export function TabBar() {
  const {
    tabs,
    activeTabId,
    setActiveTab: onActivate,
    closeTab: onClose,
    setTabMode: onModeChange,
  } = useTabsContext();
  if (tabs.length === 0) return null;

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const activeFile = activeFileOf(activeTab);
  const showModeToggle = activeTab !== null && activeFile !== null;
  // Canvas has no source-beside-preview split: the board itself is the editor,
  // so split would duplicate edit mode. Only markdown gets the third button.
  const showSplit = activeFile !== null && !isCanvasFile(activeFile.path);

  return (
    <div className="tab-bar-container" data-print-hide="true">
      <div className="tab-bar-scroll">
        {tabs.map((tab) => {
          const file = activeFileOf(tab);
          const dirty = file?.dirty ?? false;
          const label = tabLabel(tab);
          return (
            // Wrapper is a div, not a button, so the close <button> below it
            // is a valid sibling instead of an HTML-invalid nested button.
            // Click-to-activate lives on the inner `tab-activate` button.
            <div
              key={tab.id}
              className="tab-item"
              data-active={tab.id === activeTabId || undefined}
              data-tab-kind={tab.kind}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  onClose(tab.id);
                }
              }}
              title={tabPathOf(tab)}
            >
              <button
                type="button"
                className="tab-activate"
                onClick={() => onActivate(tab.id)}
                aria-label={label}
              >
                {dirty && <span className="tab-dirty-dot" />}
                {tab.kind === "folder" && <FolderIcon className="opacity-70 -ml-0.5" />}
                {tab.kind === "graph" && <GraphIcon className="opacity-70 -ml-0.5" />}
                <span className="tab-label">{label}</span>
              </button>
              <button
                type="button"
                className="tab-close"
                tabIndex={-1}
                aria-label={`Close ${label}`}
                onClick={() => onClose(tab.id)}
              >
                <TabCloseIcon />
              </button>
            </div>
          );
        })}
      </div>
      {showModeToggle && (
        <div className="mode-toggle">
          <button
            type="button"
            className="mode-toggle-btn"
            data-active={activeFile.mode === EDITOR_MODE.view || undefined}
            onClick={() => onModeChange(activeTab.id, EDITOR_MODE.view)}
            aria-label="View mode"
            title="View"
          >
            <ViewModeIcon />
          </button>
          <button
            type="button"
            className="mode-toggle-btn"
            data-active={activeFile.mode === EDITOR_MODE.edit || undefined}
            onClick={() => onModeChange(activeTab.id, EDITOR_MODE.edit)}
            aria-label="Edit mode"
            title="Edit"
          >
            <EditModeIcon />
          </button>
          {showSplit && (
            <button
              type="button"
              className="mode-toggle-btn"
              data-active={activeFile.mode === EDITOR_MODE.split || undefined}
              onClick={() => onModeChange(activeTab.id, EDITOR_MODE.split)}
              aria-label="Split mode"
              title="Split"
            >
              <SplitModeIcon />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
