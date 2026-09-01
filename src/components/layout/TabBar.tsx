import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { EditModeIcon } from "@/components/icons/EditModeIcon";
import { GraphIcon } from "@/components/icons/GraphIcon";
import { OpenIcon } from "@/components/icons/OpenIcon";
import { OutlineIcon } from "@/components/icons/OutlineIcon";
import { SparkleIcon } from "@/components/icons/SparkleIcon";
import { SplitModeIcon } from "@/components/icons/SplitModeIcon";
import { TabCloseIcon } from "@/components/icons/TabCloseIcon";
import { ViewModeIcon } from "@/components/icons/ViewModeIcon";
import { ContextMenu } from "@/components/menu/ContextMenu";
import { useSidebarLayoutContext } from "@/contexts/SidebarLayoutContext";
import { useTabsContext } from "@/contexts/TabsContext";
import { useCanSplit } from "@/hooks/useMediaQuery";
import { usePlatform } from "@/hooks/usePlatform";
import { useTabContextMenu } from "@/hooks/useTabContextMenu";
import { useTabDragReorder } from "@/hooks/useTabDragReorder";
import { isCanvasFile } from "@/lib/canvasExtensions";
import { isImageFile } from "@/lib/imageExtensions";
import { isLooseFilePath } from "@/lib/looseFile";
import { displayName } from "@/lib/paths";
import { isMobile } from "@/lib/platform";
import { EDITOR_MODE, effectiveEditorMode } from "@/lib/settings";
import { activeFileOf, type Tab, tabPathOf } from "@/lib/tabs";
import { ActionBarButton } from "./ActionBarButton";
import { TabBarActions } from "./TabBarActions";

function tabLabel(tab: Tab, t: TFunction<"common">): string {
  if (tab.kind === "graph") {
    const segments = tab.root.split(/[\\/]/).filter(Boolean);
    return t("tabBar.graphLabel", { name: segments[segments.length - 1] ?? tab.root });
  }
  // Mobile picker files carry no metadata; fall back to the path itself.
  return tab.file.metadata?.name ?? (displayName(tab.file.path) || t("tabBar.untitled"));
}

interface TabBarProps {
  // `null` when no AI provider is configured, hiding the chat toggle (same
  // convention as StatusBar's onOpenSync).
  onToggleAIChat?: (() => void) | null;
  onOpenPalette: () => void;
}

export function TabBar({ onToggleAIChat, onOpenPalette }: TabBarProps) {
  const { t } = useTranslation("common");
  const {
    tabs,
    activeTabId,
    workspace,
    setActiveTab: onActivate,
    closeTab: onClose,
    setTabMode: onModeChange,
    moveTab: onMove,
    openFileDialog,
    tocEntries,
  } = useTabsContext();
  const { outlineVisible, toggleOutline } = useSidebarLayoutContext();
  const { indicator, handlersFor } = useTabDragReorder(onMove);
  const { menu, openAt, close: closeMenu } = useTabContextMenu();
  const canSplit = useCanSplit();
  // Mobile has no native menu or keyboard shortcut, so the tab bar carries the
  // in-app controls: opening a file and toggling the outline drawer.
  const mobile = isMobile(usePlatform());
  // With nothing open the strip still carries the action buttons: on mobile
  // they are the only route to the palette and the graph, and "workspace open,
  // no document open" is exactly when the graph is most useful.
  if (tabs.length === 0) {
    return (
      <div className="tab-bar-container" data-print-hide="true">
        <div className="tab-bar-scroll" />
        <TabBarActions onOpenPalette={onOpenPalette} />
      </div>
    );
  }

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const activeFile = activeFileOf(activeTab);
  // Images have a single read-only view, so the whole view/edit/split toggle is
  // hidden for them (as opposed to canvas, which keeps view + edit).
  const showModeToggle = activeTab !== null && activeFile !== null && !isImageFile(activeFile.path);
  // Split is offered only for markdown (canvas is its own editor) and only when
  // the viewport is wide enough for two panes; phones get view + edit only.
  const showSplit = activeFile !== null && !isCanvasFile(activeFile.path) && canSplit;
  // The rendered mode: a tab stored as split shows as view on a narrow screen,
  // so the view button, not the (hidden) split button, reads as active.
  const shownMode = activeFile ? effectiveEditorMode(activeFile.mode, canSplit) : undefined;

  return (
    <div className="tab-bar-container" data-print-hide="true">
      <div className="tab-bar-scroll">
        {tabs.map((tab, index) => {
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
            // biome-ignore lint/a11y/noStaticElementInteractions: the wrapper only carries pointer affordances (drag, middle-click, right-click); the Menu key fires contextmenu on the focused inner button and bubbles here
            <div
              key={tab.id}
              className="tab-item"
              data-active={tab.id === activeTabId || undefined}
              data-tab-kind={tab.kind}
              data-loose={loose || undefined}
              data-drop={indicator?.index === index ? indicator.edge : undefined}
              data-tab-index={index}
              {...handlersFor(tab.id, index, label)}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  onClose(tab.id);
                }
              }}
              onContextMenu={(e) => openAt(e, tab.id)}
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
      {mobile && (
        <div className="mode-toggle">
          {activeFile !== null && tocEntries.length > 0 && (
            <ActionBarButton
              onClick={toggleOutline}
              label={outlineVisible ? t("sidebar.hideOutline") : t("sidebar.showOutline")}
              active={outlineVisible}
            >
              <OutlineIcon active={outlineVisible} />
            </ActionBarButton>
          )}
          <ActionBarButton onClick={openFileDialog} label={t("emptyState.openFile")}>
            <OpenIcon />
          </ActionBarButton>
        </div>
      )}
      {showModeToggle && (
        <div className="mode-toggle">
          <ActionBarButton
            onClick={() => onModeChange(activeTab.id, EDITOR_MODE.view)}
            label={t("tabBar.viewMode")}
            title={t("tabBar.view")}
            active={shownMode === EDITOR_MODE.view}
          >
            <ViewModeIcon />
          </ActionBarButton>
          <ActionBarButton
            onClick={() => onModeChange(activeTab.id, EDITOR_MODE.edit)}
            label={t("tabBar.editMode")}
            title={t("tabBar.edit")}
            active={shownMode === EDITOR_MODE.edit}
          >
            <EditModeIcon />
          </ActionBarButton>
          {showSplit && (
            <ActionBarButton
              onClick={() => onModeChange(activeTab.id, EDITOR_MODE.split)}
              label={t("tabBar.splitMode")}
              title={t("tabBar.split")}
              active={activeFile.mode === EDITOR_MODE.split}
            >
              <SplitModeIcon />
            </ActionBarButton>
          )}
        </div>
      )}
      <TabBarActions onOpenPalette={onOpenPalette} />
      {onToggleAIChat && (
        <div className="mode-toggle">
          <ActionBarButton onClick={onToggleAIChat} label={t("tabBar.aiChat")}>
            <SparkleIcon />
          </ActionBarButton>
        </div>
      )}
      <ContextMenu menu={menu} onClose={closeMenu} />
    </div>
  );
}
