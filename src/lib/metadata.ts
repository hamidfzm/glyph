// Workspace metadata index: the tags and frontmatter fields of every markdown
// file, keyed by absolute path. The Rust `scan_metadata` command returns each
// file's raw frontmatter block, which is parsed here with the same parser that
// renders it, so the index can't drift from what the document shows.

import { parseFrontmatter } from "@/lib/frontmatter";
import type { ScanStatus } from "@/lib/workspaceScan";

export interface MetadataEntry {
  path: string;
  /** Raw frontmatter block including the `---` delimiters, or null. */
  frontmatter: string | null;
  /** Inline `#tag` tokens found in the body, already lowercased. */
  tags: string[];
}

export interface MetadataScan {
  files: MetadataEntry[];
  status: ScanStatus;
}

export interface NoteMetadata {
  /** Frontmatter `tags:` plus inline `#tag` tokens, lowercased and deduped. */
  tags: string[];
  /** Frontmatter fields by lowercased name (`tags` excluded; see `tags`). */
  fields: Map<string, string>;
}

export type MetadataIndex = ReadonlyMap<string, NoteMetadata>;

export interface TagCount {
  tag: string;
  count: number;
}

export const EMPTY_METADATA_INDEX: MetadataIndex = new Map();

/** `#Project/Alpha` and `project/alpha` are the same tag. */
export function normalizeTag(tag: string): string {
  return tag.trim().replace(/^#+/, "").toLowerCase();
}

export function buildMetadataIndex(files: readonly MetadataEntry[]): MetadataIndex {
  const index = new Map<string, NoteMetadata>();

  for (const file of files) {
    const tags = new Set<string>();
    for (const tag of file.tags) {
      const normalized = normalizeTag(tag);
      if (normalized) tags.add(normalized);
    }

    const fields = new Map<string, string>();
    const parsed = file.frontmatter ? parseFrontmatter(file.frontmatter) : null;
    if (parsed) {
      for (const tag of parsed.tags ?? []) {
        const normalized = normalizeTag(tag);
        if (normalized) tags.add(normalized);
      }
      if (parsed.title) fields.set("title", parsed.title);
      if (parsed.author) fields.set("author", parsed.author);
      if (parsed.date) fields.set("date", parsed.date);
      for (const [key, value] of parsed.extra) {
        fields.set(key.toLowerCase(), value);
      }
    }

    if (tags.size === 0 && fields.size === 0) continue;
    index.set(file.path, { tags: Array.from(tags).sort(), fields });
  }

  return index;
}

/** Every tag in the workspace, most frequent first, ties broken by name. */
export function tagCounts(index: MetadataIndex): TagCount[] {
  const counts = new Map<string, number>();
  for (const meta of index.values()) {
    for (const tag of meta.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return Array.from(counts, ([tag, count]) => ({ tag, count })).sort(
    (a, b) => b.count - a.count || a.tag.localeCompare(b.tag),
  );
}

/** Files carrying `tag`, or one of its nested children (`work/urgent`). */
export function pathsWithTag(index: MetadataIndex, tag: string): string[] {
  const wanted = normalizeTag(tag);
  const out: string[] = [];
  for (const [path, meta] of index) {
    if (meta.tags.some((t) => t === wanted || t.startsWith(`${wanted}/`))) out.push(path);
  }
  return out.sort((a, b) => a.localeCompare(b));
}
