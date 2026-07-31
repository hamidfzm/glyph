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
const TAG_FIELDS = ["tag", "tags"];

/**
 * Split `query` into metadata filters and leftover search text. `fields` is the
 * set of frontmatter field names the workspace actually uses: a `word:value`
 * term naming anything else (a pasted `C:\notes\x`, a `Section:Overview`
 * heading) stays plain text instead of filtering the results down to nothing.
 */
export function parseMetadataQuery(
  query: string,
  fields: ReadonlySet<string> = new Set(),
): ParsedQuery {
  const filters: MetadataFilter[] = [];
  const text = query
    .replace(FILTER_RE, (match, rawField: string, rawValue: string) => {
      const field = rawField.toLowerCase();
      const value = rawValue.startsWith('"') ? rawValue.slice(1, -1) : rawValue;
      if (value.trim().length === 0) return match;
      if (!TAG_FIELDS.includes(field) && !fields.has(field)) return match;
      filters.push({ field, value: value.trim().toLowerCase() });
      return " ";
    })
    // Removing a filter from the middle would otherwise leave a double space,
    // which the fuzzy matcher treats as a character to match.
    .replace(/\s+/g, " ")
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
