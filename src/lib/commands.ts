// Command palette types and ranking. A `Command` is anything the palette can
// surface and invoke — a file, a heading, or an app action. Each command knows
// how to run itself, so the palette UI stays a dumb list view.
//
// `rankCommands` filters and orders a flat command list against a query using
// the fuzzy matcher in `./fuzzyMatch`. Empty queries pass through in source
// order (modulo per-section priority).

import { fuzzyMatch } from "./fuzzyMatch";

export type CommandSection = "Files" | "Headings" | "Commands";

export interface Command {
  id: string;
  /** Primary label shown in the palette row. Matched against the query. */
  title: string;
  /** Optional secondary line (file path, parent heading, accelerator). */
  subtitle?: string;
  section: CommandSection;
  /** Optional keyboard shortcut hint shown on the right edge of the row. */
  shortcut?: string;
  run: () => void;
}

export interface RankedCommand {
  command: Command;
  /** Indices in the title that matched the query — used for inline highlight. */
  matches: number[];
}

// When the query is empty, sections render in this order. Within a section,
// commands keep the order they were supplied in (so callers control recency,
// alphabetical, etc.).
const SECTION_PRIORITY: Record<CommandSection, number> = {
  Files: 0,
  Headings: 1,
  Commands: 2,
};

/**
 * Filter and rank `commands` against `query`. When the query is empty, returns
 * the input ordered by section priority then input order. When non-empty,
 * returns only matches, sorted by descending score.
 */
export function rankCommands(
  query: string,
  commands: readonly Command[],
  limit = 50,
): RankedCommand[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return commands
      .slice()
      .sort((a, b) => SECTION_PRIORITY[a.section] - SECTION_PRIORITY[b.section])
      .slice(0, limit)
      .map((command) => ({ command, matches: [] }));
  }

  const scored: Array<RankedCommand & { score: number }> = [];
  for (const command of commands) {
    const result = fuzzyMatch(trimmed, command.title);
    if (!result) continue;
    scored.push({ command, matches: result.indices, score: result.score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ command, matches }) => ({ command, matches }));
}
