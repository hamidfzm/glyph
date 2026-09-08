// Command palette types and ranking. A `Command` is anything the palette can
// surface and invoke — a file, a heading, or an app action. Each command knows
// how to run itself, so the palette UI stays a dumb list view.
//
// `rankCommands` filters and orders a flat command list against a query using
// the fuzzy matcher in `./fuzzyMatch`. Empty queries pass through in source
// order (modulo per-section priority).

import type { ComponentType } from "react";
import { fuzzyMatch } from "./fuzzyMatch";

export type CommandSection = "Files" | "Headings" | "Commands";

export interface Command {
  id: string;
  /** Primary label shown in the palette row. Matched against the query. */
  title: string;
  /** Optional secondary line (file path, parent heading, accelerator). */
  subtitle?: string;
  section: CommandSection;
  /** Optional leading icon component from `src/components/icons/`. */
  icon?: ComponentType<{ className?: string }>;
  /** Optional keyboard shortcut hint shown on the right edge of the row. */
  shortcut?: string;
  /** Absolute file path, for Files rows; what metadata filters match against. */
  path?: string;
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

export interface RankOptions {
  /**
   * Paths the query's metadata filters selected, or `null` when it carried no
   * filters. A filtered query is about documents, so non-file rows drop out.
   */
  paths?: ReadonlySet<string> | null;
  limit?: number;
}

/**
 * Filter and rank `commands` against `text`, the query with its metadata
 * filters already lifted out by the index. `paths` is what those filters
 * selected. When nothing is left to match, returns the candidates ordered by
 * section priority then input order.
 */
export function rankCommands(
  text: string,
  commands: readonly Command[],
  { paths = null, limit = 50 }: RankOptions = {},
): RankedCommand[] {
  const candidates =
    paths === null ? commands : commands.filter((c) => c.path !== undefined && paths.has(c.path));

  // The index collapses the leftover whitespace itself, so this only catches
  // the raw query the palette shows while the first answer is still in
  // flight.
  const query = text.trim();
  if (query.length === 0) {
    return candidates
      .slice()
      .sort((a, b) => SECTION_PRIORITY[a.section] - SECTION_PRIORITY[b.section])
      .slice(0, limit)
      .map((command) => ({ command, matches: [] }));
  }

  const scored: Array<RankedCommand & { score: number }> = [];
  for (const command of candidates) {
    const result = fuzzyMatch(query, command.title);
    if (!result) continue;
    scored.push({ command, matches: result.indices, score: result.score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ command, matches }) => ({ command, matches }));
}
