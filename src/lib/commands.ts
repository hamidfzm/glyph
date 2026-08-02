// Command palette types and ranking. A `Command` is anything the palette can
// surface and invoke — a file, a heading, or an app action. Each command knows
// how to run itself, so the palette UI stays a dumb list view.
//
// `rankCommands` filters and orders a flat command list against a query using
// the fuzzy matcher in `./fuzzyMatch`. Empty queries pass through in source
// order (modulo per-section priority).

import type { ComponentType } from "react";
import { fuzzyMatch } from "./fuzzyMatch";
import { EMPTY_METADATA_INDEX, type MetadataIndex, metadataFields } from "./metadata";
import { matchesFilters, parseMetadataQuery } from "./metadataQuery";

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
  /** Workspace metadata, so `tag:`/`field:` terms in the query can filter. */
  metadata?: MetadataIndex;
  limit?: number;
}

/**
 * Filter and rank `commands` against `query`. Metadata terms (`tag:foo`,
 * `status:draft`) narrow the list to matching workspace files first; the rest
 * of the query is fuzzy-matched. When nothing is left to match, returns the
 * candidates ordered by section priority then input order.
 */
export function rankCommands(
  query: string,
  commands: readonly Command[],
  { metadata = EMPTY_METADATA_INDEX, limit = 50 }: RankOptions = {},
): RankedCommand[] {
  const { filters, text } = parseMetadataQuery(query, metadataFields(metadata));
  // A metadata query is about documents, so non-file rows drop out entirely.
  const candidates =
    filters.length === 0
      ? commands
      : commands.filter((c) => c.path !== undefined && matchesFilters(metadata, c.path, filters));

  if (text.length === 0) {
    return candidates
      .slice()
      .sort((a, b) => SECTION_PRIORITY[a.section] - SECTION_PRIORITY[b.section])
      .slice(0, limit)
      .map((command) => ({ command, matches: [] }));
  }

  const scored: Array<RankedCommand & { score: number }> = [];
  for (const command of candidates) {
    const result = fuzzyMatch(text, command.title);
    if (!result) continue;
    scored.push({ command, matches: result.indices, score: result.score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ command, matches }) => ({ command, matches }));
}
