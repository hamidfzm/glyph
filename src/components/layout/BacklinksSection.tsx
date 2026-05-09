import { useState } from "react";
import type { Backlink } from "@/lib/backlinks";

interface BacklinksSectionProps {
  backlinks: Backlink[];
  workspaceRoot: string;
  onOpen: (path: string, line?: number) => void;
}

function relativeName(path: string, root: string): string {
  if (path.startsWith(`${root}/`) || path.startsWith(`${root}\\`)) {
    return path.slice(root.length + 1);
  }
  return path.split(/[\\/]/).pop() ?? path;
}

export function BacklinksSection({ backlinks, workspaceRoot, onOpen }: BacklinksSectionProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (backlinks.length === 0) return null;

  return (
    <section className="backlinks-section">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex items-center gap-1 w-full text-left text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider mb-2 hover:text-[var(--color-text-secondary)] transition-colors"
        aria-expanded={!collapsed}
      >
        <span aria-hidden="true" className="inline-block w-3">
          {collapsed ? "▸" : "▾"}
        </span>
        <span>Backlinks</span>
        <span className="text-[var(--color-text-tertiary)] font-normal normal-case tracking-normal">
          {backlinks.length}
        </span>
      </button>
      {!collapsed && (
        <ul className="space-y-1">
          {backlinks.map((b) => (
            <li key={`${b.source}:${b.line}`}>
              <button
                type="button"
                onClick={() => onOpen(b.source, b.line)}
                className="block w-full text-left text-sm px-2 py-1 rounded-[var(--glyph-radius-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
                title={`${b.source}:${b.line}`}
              >
                <div className="truncate font-medium">{relativeName(b.source, workspaceRoot)}</div>
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
