import { useTranslation } from "react-i18next";
import type { Backlink } from "@/lib/backlinks";
import { relativeToRoot } from "@/lib/paths";

interface BacklinksSectionProps {
  backlinks: Backlink[];
  workspaceRoot: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onOpen: (path: string, line?: number) => void;
}

// Always rendered, empty included: a note without backlinks would otherwise
// pull the block out of the panel and shift everything above it.
export function BacklinksSection({
  backlinks,
  workspaceRoot,
  collapsed,
  onToggleCollapsed,
  onOpen,
}: BacklinksSectionProps) {
  const { t } = useTranslation("common");

  return (
    <section className="backlinks-section">
      <button
        type="button"
        onClick={onToggleCollapsed}
        className="flex items-center gap-1 w-full text-start text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider mb-2 hover:text-[var(--color-text-secondary)] transition-colors"
        aria-expanded={!collapsed}
      >
        <span aria-hidden="true" className="inline-block w-3">
          {collapsed ? "▸" : "▾"}
        </span>
        <span>{t("backlinks.heading")}</span>
        <span className="text-[var(--color-text-tertiary)] font-normal normal-case tracking-normal">
          {backlinks.length}
        </span>
      </button>
      {!collapsed && backlinks.length === 0 && (
        <p className="px-2 text-xs text-[var(--color-text-tertiary)]">{t("backlinks.empty")}</p>
      )}
      {!collapsed && backlinks.length > 0 && (
        <ul className="space-y-1">
          {backlinks.map((b) => (
            <li key={`${b.source}:${b.line}`}>
              <button
                type="button"
                onClick={() => onOpen(b.source, b.line)}
                className="block w-full text-start text-sm px-2 py-1 rounded-[var(--glyph-radius-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)] active:bg-[var(--color-border)] hover:text-[var(--color-text-primary)] transition-colors"
                title={`${b.source}:${b.line}`}
              >
                <div className="truncate font-medium">
                  {relativeToRoot(b.source, workspaceRoot)}
                </div>
                <div className="truncate text-xs text-[var(--color-text-tertiary)]">
                  {b.snippet}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
