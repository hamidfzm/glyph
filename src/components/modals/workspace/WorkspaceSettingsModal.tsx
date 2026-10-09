import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ModalCloseIcon } from "@/components/icons/ModalCloseIcon";
import { PluginMountSlot } from "@/components/plugins/PluginMountSlot";
import { usePluginsOptional } from "@/contexts/PluginsContext";
import { useWorkspaceRoot } from "@/contexts/TabsContext";
import { useRegistryEntries } from "@/hooks/usePluginRegistry";
import { contributionKey } from "@/lib/plugins/contributionKey";
import { SyncSettingsTab } from "./SyncSettingsTab";
import { WebsiteSettingsTab } from "./WebsiteSettingsTab";

/** A built-in tab, or the tab a plugin added (`plugin:` then its contribution key). */
export type WorkspaceSettingsTabId = "website" | "sync" | `plugin:${string}`;

interface WorkspaceSettingsModalProps {
  open: boolean;
  onClose: () => void;
  tab: WorkspaceSettingsTabId;
  onTabChange: (tab: WorkspaceSettingsTabId) => void;
}

/**
 * Per-workspace settings, stored under the workspace's `.glyph/` folder so
 * they travel with it (unlike the global Settings modal, which is per-app).
 * Tabbed like SettingsModal; Website is the first tab, and plugins add theirs
 * after the built-in ones. The active tab is controlled by the opener so
 * "Cloud Sync…" still lands on the Sync tab when the modal is already showing
 * another one.
 */
export function WorkspaceSettingsModal({
  open,
  onClose,
  tab,
  onTabChange,
}: WorkspaceSettingsModalProps) {
  const { t } = useTranslation("workspaceSettings");
  const workspaceRoot = useWorkspaceRoot();
  const pluginPanels = useRegistryEntries(usePluginsOptional()?.workspaceSettingsPanels ?? null);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  if (!open) return null;

  const pluginTabs = pluginPanels.map((panel) => ({
    id: `plugin:${contributionKey(panel)}` as const,
    label: panel.title,
    panel,
  }));
  const tabs: { id: WorkspaceSettingsTabId; label: string }[] = [
    { id: "website", label: t("tabs.website") },
    { id: "sync", label: t("tabs.sync") },
    ...pluginTabs,
  ];
  // A plugin's tab goes when the plugin unloads; the modal falls back to the first one.
  const activeTab = tabs.some((entry) => entry.id === tab) ? tab : "website";
  const activePanel = pluginTabs.find((entry) => entry.id === activeTab)?.panel;

  return (
    <div
      className="settings-overlay"
      onClick={handleBackdropClick}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={t("modal.heading")}
    >
      <div className="settings-modal">
        <div className="settings-header">
          <h2>{t("modal.heading")}</h2>
          <button
            type="button"
            className="settings-close"
            onClick={onClose}
            aria-label={t("modal.close")}
          >
            <ModalCloseIcon />
          </button>
        </div>

        {!workspaceRoot ? (
          <div className="settings-body settings-workspace">
            <p className="settings-empty">{t("empty")}</p>
          </div>
        ) : (
          <div className="settings-main">
            <nav className="settings-nav">
              {tabs.map((entry) => (
                <button
                  type="button"
                  key={entry.id}
                  className="settings-tab"
                  data-active={activeTab === entry.id}
                  onClick={() => onTabChange(entry.id)}
                >
                  {entry.label}
                </button>
              ))}
            </nav>

            {/* `settings-sync` carries the segmented-control and init-banner
                styles, which key off it as a direct parent. */}
            <div
              className={`settings-body settings-workspace${activeTab === "sync" ? " settings-sync" : ""}`}
            >
              {activeTab === "website" && <WebsiteSettingsTab onClose={onClose} />}
              {activeTab === "sync" && <SyncSettingsTab />}
              {activePanel && (
                <PluginMountSlot key={activeTab} contribution={activePanel} className="block" />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
