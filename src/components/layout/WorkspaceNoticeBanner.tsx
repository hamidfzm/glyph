import { useTranslation } from "react-i18next";
import { BannerCloseIcon } from "@/components/icons/BannerCloseIcon";
import type { WorkspaceNotice } from "@/hooks/useWorkspaceNotice";

interface WorkspaceNoticeBannerProps {
  notice: WorkspaceNotice | null;
  onDismiss: () => void;
}

/**
 * Bar shown for a workspace notice (see #262): a refusal (the folder overlaps an
 * open workspace, or sits inside another workspace's `.glyph/`) or a warning
 * (the folder opened despite sitting inside a parent git repo). Mirrors
 * {@link UpdateBanner}'s layout; the close button always hides it. Refusals also
 * auto-dismiss, while warnings stay up until dismissed (see `useWorkspaceNotice`).
 */
export function WorkspaceNoticeBanner({ notice, onDismiss }: WorkspaceNoticeBannerProps) {
  // The notice text lives in the `workspace` namespace; the dismiss label in
  // `common`. Resolving here (not at notice-creation time) re-localizes the
  // open banner when the user switches language.
  const { t } = useTranslation(["common", "workspace"]);
  if (!notice) return null;

  return (
    <div
      data-print-hide="true"
      role="status"
      className="flex items-center gap-3 px-4 py-2 border-b border-[var(--color-border)] border-s-4 border-s-[var(--color-warning,#b45309)] bg-[var(--color-banner-bg)] text-sm text-[var(--color-text-primary)] select-none shrink-0"
    >
      <span>{t(notice.key, { ns: "workspace", ...notice.values })}</span>
      <button
        type="button"
        className="ms-auto cursor-pointer text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
        onClick={onDismiss}
        aria-label={t("workspaceBanner.dismiss")}
      >
        <BannerCloseIcon />
      </button>
    </div>
  );
}
