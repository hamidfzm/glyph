import { useTranslation } from "react-i18next";
import { relativeToRoot } from "@/lib/paths";
import type { RelinkRequest } from "@/lib/vault";
import { PromptModal } from "./PromptModal";

interface RelinkConfirmModalProps {
  request: RelinkRequest;
  onChoose: (confirmed: boolean) => void;
}

/**
 * Lists the files a rename or move rewrites links in before any of them is
 * written, so backing out leaves every file untouched.
 */
export function RelinkConfirmModal({ request, onChoose }: RelinkConfirmModalProps) {
  const { t } = useTranslation("workspace");
  const unsaved = new Set(request.unsaved);

  const actions = (
    <>
      <button type="button" className="settings-secondary-btn" onClick={() => onChoose(false)}>
        {t("relink.cancel")}
      </button>
      <button
        type="button"
        className="settings-primary-btn"
        data-autofocus
        onClick={() => onChoose(true)}
      >
        {t("relink.update")}
      </button>
    </>
  );

  return (
    <PromptModal
      title={t("relink.title")}
      message={t("relink.message")}
      onCancel={() => onChoose(false)}
      actions={actions}
    >
      <ul>
        {request.files.map((file) => (
          <li key={file.path}>
            <span>{relativeToRoot(file.path, request.root)}</span>
            <span className="prompt-detail">{t("relink.links", { count: file.links })}</span>
            {unsaved.has(file.path) && <span className="prompt-detail">{t("relink.unsaved")}</span>}
          </li>
        ))}
      </ul>
    </PromptModal>
  );
}
