import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { type Command, type CommandSection, rankCommands } from "@/lib/commands";
import { CommandPaletteItem } from "./CommandPaletteItem";

interface CommandPaletteProps {
  open: boolean;
  query: string;
  commands: readonly Command[];
  onQueryChange: (next: string) => void;
  onClose: () => void;
}

const SECTION_ORDER: CommandSection[] = ["Files", "Headings", "Commands"];

export function CommandPalette({
  open,
  query,
  commands,
  onQueryChange,
  onClose,
}: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const ranked = useMemo(() => rankCommands(query, commands), [query, commands]);

  // Reset selection when the result set changes so the top match is primed
  // for Enter.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [ranked]);

  // Focus the input whenever the palette opens.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const runAtIndex = (index: number) => {
    const hit = ranked[index];
    if (!hit) return;
    onClose();
    hit.command.run();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, ranked.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      runAtIndex(selectedIndex);
    }
  };

  const handleOverlayKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  // Group ranked hits by section, preserving overall rank order.
  const sections = SECTION_ORDER.map((section) => ({
    section,
    items: ranked
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.command.section === section),
  })).filter(({ items }) => items.length > 0);

  return (
    <div
      className="command-palette-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={handleOverlayKeyDown}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      data-print-hide="true"
    >
      <div className="command-palette">
        <input
          ref={inputRef}
          type="text"
          className="command-palette-input"
          placeholder="Type a command, file, or heading…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Command palette query"
        />
        <div className="command-palette-results">
          {sections.length === 0 ? (
            <div className="command-palette-empty">No results</div>
          ) : (
            sections.map(({ section, items }) => (
              <div key={section} className="command-palette-group">
                <div className="command-palette-section">{section}</div>
                {items.map(({ row, index }) => (
                  <CommandPaletteItem
                    key={row.command.id}
                    row={row}
                    selected={selectedIndex === index}
                    onActivate={() => runAtIndex(index)}
                    onHover={() => setSelectedIndex(index)}
                  />
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
