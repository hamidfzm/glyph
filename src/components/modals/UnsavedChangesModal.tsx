import { useTranslation } from "react-i18next";
import { basename } from "@/lib/paths";
import { PromptModal } from "./PromptModal";

/** What the user picked in the unsaved-changes prompt. */
export type UnsavedChoice = "save" | "discard" | "cancel";

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

  const actions = (
    <>
      <button type="button" className="settings-secondary-btn" onClick={() => onChoose("cancel")}>
        {t("unsavedChanges.cancel")}
      </button>
      <button type="button" className="settings-danger-btn" onClick={() => onChoose("discard")}>
        {t("unsavedChanges.dontSave")}
      </button>
      <button
        type="button"
        className="settings-primary-btn"
        data-autofocus
        onClick={() => onChoose("save")}
      >
        {t("unsavedChanges.save")}
      </button>
    </>
  );

  return (
    <PromptModal
      title={t("unsavedChanges.title")}
      message={t("unsavedChanges.promptMessage")}
      onCancel={() => onChoose("cancel")}
      actions={actions}
    >
      <ul>
        {files.map((path) => (
          <li key={path}>{basename(path)}</li>
        ))}
      </ul>
    </PromptModal>
  );
}
