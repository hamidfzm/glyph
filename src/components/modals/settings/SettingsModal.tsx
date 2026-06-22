import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ModalCloseIcon } from "@/components/icons/ModalCloseIcon";
import { useSettings } from "@/hooks/useSettings";
import { AITab } from "./AITab";
import { AppearanceTab } from "./AppearanceTab";
import { BehaviorTab } from "./BehaviorTab";
import { EditorTab } from "./EditorTab";
import { HotkeysTab } from "./HotkeysTab";
import { LayoutTab } from "./LayoutTab";
import { PrintTab } from "./PrintTab";
import { PrivacyTab } from "./PrivacyTab";

type Tab = "appearance" | "layout" | "behavior" | "editor" | "hotkeys" | "ai" | "print" | "privacy";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { t } = useTranslation("settings");
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
    { id: "appearance", label: t("modal.tabs.appearance") },
    { id: "layout", label: t("modal.tabs.layout") },
    { id: "behavior", label: t("modal.tabs.behavior") },
    { id: "editor", label: t("modal.tabs.editor") },
    { id: "hotkeys", label: t("modal.tabs.hotkeys") },
    { id: "ai", label: t("modal.tabs.ai") },
    { id: "print", label: t("modal.tabs.print") },
    { id: "privacy", label: t("modal.tabs.privacy") },
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
          <h2>{t("modal.title")}</h2>
          <button type="button" className="settings-close" onClick={onClose}>
            <ModalCloseIcon />
          </button>
        </div>

        <div className="settings-main">
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
            {tab === "editor" && <EditorTab />}
            {tab === "hotkeys" && <HotkeysTab />}
            {tab === "ai" && <AITab />}
            {tab === "print" && <PrintTab />}
            {tab === "privacy" && <PrivacyTab />}
          </div>
        </div>

        <div className="settings-footer">
          <button type="button" className="settings-reset-btn" onClick={resetSettings}>
            {t("modal.reset")}
          </button>
          <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
            {t("modal.changesApply")}
          </span>
        </div>
      </div>
    </div>
  );
}
