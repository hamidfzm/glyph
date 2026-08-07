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
  // The separator is collapsed and trimmed so `#work/` and `#work//urgent`
  // can't open a blank level in the tag tree.
  return tag
    .trim()
    .replace(/^#+/, "")
    .toLowerCase()
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

// Mirrors SCAN_MAX_TAG_CHARS in src-tauri/src/commands/metadata.rs, which bounds
// inline tags at the source. Frontmatter tags arrive inside the 8 KB block, so
// they are bounded here instead: without a cap one crafted `a/a/a/…` tag would
// expand into thousands of ancestors and nest the tag tree just as deep.
const MAX_TAG_CHARS = 64;

// A plain scalar (`tags: work, ideas`) reaches us as one string, so split it
// the way Obsidian does instead of indexing "work, ideas" as a single tag.
function addTags(raw: string, into: Set<string>): void {
  for (const part of raw.split(/[,\s]+/)) {
    const tag = normalizeTag(part);
    if (tag && tag.length <= MAX_TAG_CHARS) into.add(tag);
  }
}

export function buildMetadataIndex(files: readonly MetadataEntry[]): MetadataIndex {
  const index = new Map<string, NoteMetadata>();

  for (const file of files) {
    const tags = new Set<string>();
    for (const tag of file.tags) {
      addTags(tag, tags);
    }

    const fields = new Map<string, string>();
    const parsed = file.frontmatter ? parseFrontmatter(file.frontmatter) : null;
    if (parsed) {
      for (const tag of parsed.tags ?? []) {
        addTags(tag, tags);
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

/** Every frontmatter field name used anywhere in the workspace. */
export function metadataFields(index: MetadataIndex): Set<string> {
  const fields = new Set<string>();
  for (const meta of index.values()) {
    for (const field of meta.fields.keys()) fields.add(field);
  }
  return fields;
}

/** `project/glyph/ui` also belongs to `project/glyph` and to `project`. */
function withAncestors(tag: string): string[] {
  const parts = tag.split("/");
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
}

/**
 * Every tag in the workspace, most frequent first, ties broken by name.
 * A nested tag counts toward each of its ancestors, once per file, so a
 * parent's count matches the file list `pathsWithTag` returns for it.
 */
export function tagCounts(index: MetadataIndex): TagCount[] {
  const counts = new Map<string, number>();
  for (const meta of index.values()) {
    const inFile = new Set<string>();
    for (const tag of meta.tags) {
      for (const ancestor of withAncestors(tag)) inFile.add(ancestor);
    }
    for (const tag of inFile) {
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
