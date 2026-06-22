import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { EditModeIcon } from "@/components/icons/EditModeIcon";
import { GraphIcon } from "@/components/icons/GraphIcon";
import { SplitModeIcon } from "@/components/icons/SplitModeIcon";
import { TabCloseIcon } from "@/components/icons/TabCloseIcon";
import { ViewModeIcon } from "@/components/icons/ViewModeIcon";
import { useTabsContext } from "@/contexts/TabsContext";
import { activeFileOf, type Tab, tabPathOf } from "@/hooks/useTabs";
import { isCanvasFile } from "@/lib/canvasExtensions";
import { isImageFile } from "@/lib/imageExtensions";
import { isLooseFilePath } from "@/lib/looseFile";
import { EDITOR_MODE } from "@/lib/settings";

function tabLabel(tab: Tab, t: TFunction<"common">): string {
  if (tab.kind === "graph") {
    const segments = tab.root.split(/[\\/]/).filter(Boolean);
    return t("tabBar.graphLabel", { name: segments[segments.length - 1] ?? tab.root });
  }
  return tab.file.metadata?.name ?? t("tabBar.untitled");
}

export function TabBar() {
  const { t } = useTranslation("common");
  const {
    tabs,
    activeTabId,
    workspace,
    setActiveTab: onActivate,
    closeTab: onClose,
    setTabMode: onModeChange,
  } = useTabsContext();
  if (tabs.length === 0) return null;

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const activeFile = activeFileOf(activeTab);
  // Images have a single read-only view, so the whole view/edit/split toggle is
  // hidden for them (as opposed to canvas, which keeps view + edit).
  const showModeToggle = activeTab !== null && activeFile !== null && !isImageFile(activeFile.path);
  // Canvas has no source-beside-preview split: the board itself is the editor,
  // so split would duplicate edit mode. Only markdown gets the third button.
  const showSplit = activeFile !== null && !isCanvasFile(activeFile.path);

  return (
    <div className="tab-bar-container" data-print-hide="true">
      <div className="tab-bar-scroll">
        {tabs.map((tab) => {
          const file = activeFileOf(tab);
          const dirty = file?.dirty ?? false;
          const label = tabLabel(tab, t);
          // Mark file tabs opened from outside the workspace so they read as
          // independent documents, not part of the project tree.
          const loose = tab.kind === "file" && isLooseFilePath(tab.file.path, workspace?.root);
          return (
            // Wrapper is a div, not a button, so the close <button> below it
            // is a valid sibling instead of an HTML-invalid nested button.
            // Click-to-activate lives on the inner `tab-activate` button.
            <div
              key={tab.id}
              className="tab-item"
              data-active={tab.id === activeTabId || undefined}
              data-tab-kind={tab.kind}
              data-loose={loose || undefined}
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
                {tab.kind === "graph" && <GraphIcon className="opacity-70 -ms-0.5" />}
                <span className="tab-label">{label}</span>
              </button>
              <button
                type="button"
                className="tab-close"
                tabIndex={-1}
                aria-label={t("tabBar.closeTab", { label })}
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
            aria-label={t("tabBar.viewMode")}
            title={t("tabBar.view")}
          >
            <ViewModeIcon />
          </button>
          <button
            type="button"
            className="mode-toggle-btn"
            data-active={activeFile.mode === EDITOR_MODE.edit || undefined}
            onClick={() => onModeChange(activeTab.id, EDITOR_MODE.edit)}
            aria-label={t("tabBar.editMode")}
            title={t("tabBar.edit")}
          >
            <EditModeIcon />
          </button>
          {showSplit && (
            <button
              type="button"
              className="mode-toggle-btn"
              data-active={activeFile.mode === EDITOR_MODE.split || undefined}
              onClick={() => onModeChange(activeTab.id, EDITOR_MODE.split)}
              aria-label={t("tabBar.splitMode")}
              title={t("tabBar.split")}
            >
              <SplitModeIcon />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
