// Metadata filters in a palette query: `tag:foo`, `status:draft`,
// `project:"side quest"`. Field syntax follows Obsidian's so notes migrating
// from it keep working. Whatever is left after the filters is plain search
// text and still goes through the fuzzy matcher.

import type { MetadataIndex, NoteMetadata } from "@/lib/metadata";
import { normalizeTag } from "@/lib/metadata";

export interface MetadataFilter {
  /** Lowercased field name; `tag`/`tags` match the tag set. */
  field: string;
  /** Lowercased value, unquoted. */
  value: string;
}

export interface ParsedQuery {
  filters: MetadataFilter[];
  /** The query minus its filters, trimmed. */
  text: string;
}

const FILTER_RE = /([A-Za-z][\w-]*):("[^"]*"|\S+)/g;

export function parseMetadataQuery(query: string): ParsedQuery {
  const filters: MetadataFilter[] = [];
  const text = query
    .replace(FILTER_RE, (match, field: string, rawValue: string) => {
      const value = rawValue.startsWith('"') ? rawValue.slice(1, -1) : rawValue;
      if (value.trim().length === 0) return match;
      filters.push({ field: field.toLowerCase(), value: value.trim().toLowerCase() });
      return " ";
    })
    .trim();

  return { filters, text };
}

function matchesFilter(meta: NoteMetadata, filter: MetadataFilter): boolean {
  if (filter.field === "tag" || filter.field === "tags") {
    const wanted = normalizeTag(filter.value);
    return meta.tags.some((tag) => tag === wanted || tag.startsWith(`${wanted}/`));
  }
  // Substring, so `project:glyph` still finds "Glyph Docs".
  return meta.fields.get(filter.field)?.toLowerCase().includes(filter.value) ?? false;
}

/** Whether the file at `path` satisfies every filter (AND, like Obsidian). */
export function matchesFilters(
  index: MetadataIndex,
  path: string,
  filters: readonly MetadataFilter[],
): boolean {
  if (filters.length === 0) return true;
  const meta = index.get(path);
  if (!meta) return false;
  return filters.every((filter) => matchesFilter(meta, filter));
}
