import { activeFileOf, type Tab, tabPathOf } from "../../hooks/useTabs";
import type { EditorMode } from "../../lib/settings";
import { FolderIcon } from "../icons/FolderIcon";

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onModeChange?: (id: string, mode: EditorMode) => void;
}

function tabLabel(tab: Tab): string {
  if (tab.kind === "folder") {
    const segments = tab.root.split(/[\\/]/).filter(Boolean);
    return segments[segments.length - 1] ?? tab.root;
  }
  return tab.file.metadata?.name ?? "Untitled";
}

export function TabBar({ tabs, activeTabId, onActivate, onClose, onModeChange }: TabBarProps) {
  if (tabs.length === 0) return null;

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const activeFile = activeFileOf(activeTab);
  const showModeToggle = activeTab !== null && activeFile !== null && onModeChange !== undefined;

  return (
    <div className="tab-bar-container" data-print-hide="true">
      <div className="tab-bar-scroll">
        {tabs.map((tab) => {
          const file = activeFileOf(tab);
          const dirty = file?.dirty ?? false;
          const label = tabLabel(tab);
          return (
            <button
              key={tab.id}
              type="button"
              className="tab-item"
              data-active={tab.id === activeTabId || undefined}
              data-tab-kind={tab.kind}
              onClick={() => onActivate(tab.id)}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  onClose(tab.id);
                }
              }}
              title={tabPathOf(tab)}
            >
              {dirty && <span className="tab-dirty-dot" />}
              {tab.kind === "folder" && <FolderIcon className="opacity-70 -ml-0.5" />}
              <span className="tab-label">{label}</span>
              <button
                type="button"
                className="tab-close"
                tabIndex={-1}
                aria-label={`Close ${label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path
                    d="M3 3L9 9M9 3L3 9"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </button>
          );
        })}
      </div>
      {showModeToggle && (
        <div className="mode-toggle">
          <button
            type="button"
            className="mode-toggle-btn"
            data-active={activeFile.mode === "view" || undefined}
            onClick={() => onModeChange(activeTab.id, "view")}
            aria-label="View mode"
            title="View"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path
                d="M1 7s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4z"
                stroke="currentColor"
                strokeWidth="1.3"
              />
              <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          </button>
          <button
            type="button"
            className="mode-toggle-btn"
            data-active={activeFile.mode === "edit" || undefined}
            onClick={() => onModeChange(activeTab.id, "edit")}
            aria-label="Edit mode"
            title="Edit"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path
                d="M10.5 1.5l2 2-8 8H2.5v-2l8-8z"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className="mode-toggle-btn"
            data-active={activeFile.mode === "split" || undefined}
            onClick={() => onModeChange(activeTab.id, "split")}
            aria-label="Split mode"
            title="Split"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <rect
                x="1.5"
                y="2"
                width="11"
                height="10"
                rx="1.5"
                stroke="currentColor"
                strokeWidth="1.3"
              />
              <line x1="7" y1="2" x2="7" y2="12" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
