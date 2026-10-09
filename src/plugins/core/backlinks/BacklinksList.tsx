import { useSyncExternalStore } from "react";
import type { BacklinksStore } from "./backlinksStore";
import { relativePath } from "./relativePath";

interface BacklinksListProps {
  store: BacklinksStore;
  emptyLabel: string;
  onOpen: (path: string, line: number) => void;
}

// Always rendered, empty included: a note without backlinks would otherwise
// pull the block out of the panel and shift everything above it.
export function BacklinksList({ store, emptyLabel, onOpen }: BacklinksListProps) {
  const { root, rows } = useSyncExternalStore(store.subscribe, store.get);

  if (rows.length === 0) {
    return <p className="px-2 text-xs text-[var(--color-text-tertiary)]">{emptyLabel}</p>;
  }
  return (
    <ul className="space-y-1">
      {rows.map((row) => (
        <li key={`${row.source}:${row.line}`}>
          <button
            type="button"
            onClick={() => onOpen(row.source, row.line)}
            className="block w-full text-start text-sm px-2 py-1 rounded-[var(--glyph-radius-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)] active:bg-[var(--color-border)] hover:text-[var(--color-text-primary)] transition-colors"
            title={`${row.source}:${row.line}`}
          >
            <div className="truncate font-medium">{relativePath(row.source, root)}</div>
            <div className="truncate text-xs text-[var(--color-text-tertiary)]">{row.snippet}</div>
          </button>
        </li>
      ))}
    </ul>
  );
}
