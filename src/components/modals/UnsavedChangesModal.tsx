import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { UnsavedChoice } from "@/hooks/useUnsavedChangesPrompt";
import { basename } from "@/lib/paths";

interface UnsavedChangesModalProps {
  /** Full paths of the dirty documents the close would drop. */
  files: string[];
  onChoose: (choice: UnsavedChoice) => void;
}

/**
 * Save / Don't Save / Cancel prompt shown when a close would discard unsaved
 * edits and Auto Save is off. It is an in-app modal because the dialog
 * plugin's `ask` offers two buttons and this choice needs three.
 */
export function UnsavedChangesModal({ files, onChoose }: UnsavedChangesModalProps) {
  const { t } = useTranslation("workspace");
  const saveRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    /* c8 ignore next 2 -- both nodes exist whenever this effect runs */
    saveRef.current?.focus();
    return () => previous?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onChoose("cancel");
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onChoose]);

  // The decision blocks a close, so keyboard focus stays inside it; the app
  // behind the overlay must not be reachable to make further edits. The three
  // buttons are the only focusable elements, so the trap is a wrap-around.
  const trapTab = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const buttons = Array.from(e.currentTarget.querySelectorAll("button"));
    e.preventDefault();
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = current + (e.shiftKey ? -1 : 1);
    buttons[(next + buttons.length) % buttons.length].focus();
  };

  return (
    <div
      className="settings-overlay unsaved-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unsaved-title"
      aria-describedby="unsaved-message"
      onKeyDown={trapTab}
    >
      <div className="settings-modal unsaved-modal">
        <div className="settings-header">
          <h2 id="unsaved-title">{t("unsavedChanges.title")}</h2>
        </div>
        <div className="unsaved-body">
          <p id="unsaved-message">{t("unsavedChanges.promptMessage")}</p>
          <ul>
            {files.map((path) => (
              <li key={path}>{basename(path)}</li>
            ))}
          </ul>
        </div>
        <div className="settings-footer unsaved-footer">
          <button
            type="button"
            className="settings-secondary-btn"
            onClick={() => onChoose("cancel")}
          >
            {t("unsavedChanges.cancel")}
          </button>
          <button type="button" className="settings-danger-btn" onClick={() => onChoose("discard")}>
            {t("unsavedChanges.dontSave")}
          </button>
          <button
            ref={saveRef}
            type="button"
            className="settings-primary-btn"
            onClick={() => onChoose("save")}
          >
            {t("unsavedChanges.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
