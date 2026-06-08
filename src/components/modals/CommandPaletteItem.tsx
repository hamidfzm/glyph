import type { ReactNode } from "react";
import type { RankedCommand } from "@/lib/commands";

interface CommandPaletteItemProps {
  row: RankedCommand;
  selected: boolean;
  onActivate: () => void;
  onHover: () => void;
}

// A single result row in the command palette: title (with fuzzy-match
// highlights), optional subtitle, and optional shortcut hint.
export function CommandPaletteItem({
  row,
  selected,
  onActivate,
  onHover,
}: CommandPaletteItemProps) {
  return (
    <button
      type="button"
      onClick={onActivate}
      onMouseEnter={onHover}
      onFocus={onHover}
      className="command-palette-item"
      data-selected={selected ? "true" : undefined}
      // The visible input keeps focus while arrow keys drive selection — items
      // are pointer-actionable but never the keyboard's focus target.
      tabIndex={-1}
    >
      <span className="command-palette-title">
        {renderHighlight(row.command.title, row.matches)}
      </span>
      {row.command.subtitle && (
        <span className="command-palette-subtitle">{row.command.subtitle}</span>
      )}
      {row.command.shortcut && (
        <span className="command-palette-shortcut">{row.command.shortcut}</span>
      )}
    </button>
  );
}

function renderHighlight(text: string, indices: readonly number[]): ReactNode {
  if (indices.length === 0) return text;
  const set = new Set(indices);
  // Group runs of matched / unmatched chars so each React key is anchored at
  // the run's starting index — stable across re-renders of the same string.
  const runs: Array<{ text: string; matched: boolean; start: number }> = [];
  let i = 0;
  for (const ch of text) {
    const matched = set.has(i);
    const last = runs[runs.length - 1];
    if (last && last.matched === matched) {
      last.text += ch;
    } else {
      runs.push({ text: ch, matched, start: i });
    }
    i++;
  }
  return runs.map((run) =>
    run.matched ? (
      <mark key={`m:${run.start}`} className="command-palette-mark">
        {run.text}
      </mark>
    ) : (
      <span key={`t:${run.start}`}>{run.text}</span>
    ),
  );
}
