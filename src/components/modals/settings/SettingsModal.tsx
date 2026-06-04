import { useCallback, useEffect, useState } from "react";
import { useSettings } from "@/hooks/useSettings";
import { AITab } from "./AITab";
import { AppearanceTab } from "./AppearanceTab";
import { BehaviorTab } from "./BehaviorTab";
import { ExperimentalTab } from "./ExperimentalTab";
import { LayoutTab } from "./LayoutTab";
import { PrintTab } from "./PrintTab";
import { PrivacyTab } from "./PrivacyTab";

type Tab = "appearance" | "layout" | "behavior" | "ai" | "print" | "privacy" | "experimental";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
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
    { id: "privacy", label: "Privacy" },
    { id: "experimental", label: "Experimental" },
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
          {tab === "privacy" && <PrivacyTab />}
          {tab === "experimental" && <ExperimentalTab />}
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
