import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ModalCloseIcon } from "@/components/icons/ModalCloseIcon";
import { useWorkspaceRoot } from "@/contexts/TabsContext";
import { WebsiteSettingsTab } from "./WebsiteSettingsTab";

type Tab = "website";

interface WorkspaceSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Per-workspace settings, stored under the workspace's `.glyph/` folder so
 * they travel with it (unlike the global Settings modal, which is per-app).
 * Tabbed like SettingsModal; Website is the first tab.
 */
export function WorkspaceSettingsModal({ open, onClose }: WorkspaceSettingsModalProps) {
  const { t } = useTranslation("workspaceSettings");
  const workspaceRoot = useWorkspaceRoot();
  const [tab, setTab] = useState<Tab>("website");

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

  const tabs: { id: Tab; label: string }[] = [{ id: "website", label: t("tabs.website") }];

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
                  data-active={tab === entry.id}
                  onClick={() => setTab(entry.id)}
                >
                  {entry.label}
                </button>
              ))}
            </nav>

            <div className="settings-body settings-workspace">
              {tab === "website" && <WebsiteSettingsTab onClose={onClose} />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
