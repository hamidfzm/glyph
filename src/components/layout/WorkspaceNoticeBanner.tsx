import { BannerCloseIcon } from "@/components/icons/BannerCloseIcon";

interface WorkspaceNoticeBannerProps {
  notice: string | null;
  onDismiss: () => void;
}

/**
 * Transient bar shown when a folder can't be opened as a workspace (it's nested
 * inside a parent git repo, or overlaps an already-open workspace — see #262).
 * Mirrors {@link UpdateBanner}'s layout; the close button hides it, and it
 * also auto-dismisses (see `useWorkspaceNotice`).
 */
export function WorkspaceNoticeBanner({ notice, onDismiss }: WorkspaceNoticeBannerProps) {
  if (!notice) return null;

  return (
    <div
      data-print-hide="true"
      role="status"
      className="flex items-center gap-3 px-4 py-2 border-b border-[var(--color-border)] border-l-4 border-l-[var(--color-warning,#b45309)] bg-[var(--color-banner-bg)] text-sm text-[var(--color-text-primary)] select-none shrink-0"
    >
      <span>{notice}</span>
      <button
        type="button"
        className="ml-auto cursor-pointer text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
        onClick={onDismiss}
        aria-label="Dismiss workspace notice"
      >
        <BannerCloseIcon />
      </button>
    </div>
  );
}
