import { FAILSAFE_SCHEMA, load } from "js-yaml";

export interface ParsedFrontmatter {
  title?: string;
  author?: string;
  date?: string;
  tags?: string[];
  extra: Array<[key: string, value: string]>;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const KNOWN_KEYS = new Set(["title", "author", "date", "tags"]);

// FAILSAFE_SCHEMA keeps every scalar as a string so a date like `2026-04-15`
// renders verbatim and booleans don't become `true`/`false`. Sequences and
// mappings still parse, which is all we need for `tags: [a, b]`.
export function parseFrontmatter(content: string): ParsedFrontmatter | null {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return null;

  let data: unknown;
  try {
    data = load(match[1], { schema: FAILSAFE_SCHEMA });
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;

  const obj = data as Record<string, unknown>;
  const result: ParsedFrontmatter = { extra: [] };

  if (typeof obj.title === "string" && obj.title.length > 0) result.title = obj.title;
  if (typeof obj.author === "string" && obj.author.length > 0) result.author = obj.author;
  if (typeof obj.date === "string" && obj.date.length > 0) result.date = obj.date;

  if (Array.isArray(obj.tags)) {
    const tags = obj.tags.filter((t): t is string => typeof t === "string" && t.length > 0);
    if (tags.length > 0) result.tags = tags;
  } else if (typeof obj.tags === "string" && obj.tags.length > 0) {
    result.tags = [obj.tags];
  }

  for (const [key, value] of Object.entries(obj)) {
    if (KNOWN_KEYS.has(key)) continue;
    const stringified = stringifyExtra(value);
    if (stringified !== null) result.extra.push([key, stringified]);
  }

  if (
    !result.title &&
    !result.author &&
    !result.date &&
    !result.tags?.length &&
    result.extra.length === 0
  ) {
    return null;
  }

  return result;
}

function stringifyExtra(value: unknown): string | null {
  if (typeof value === "string") return value.length > 0 ? value : null;
  if (Array.isArray(value)) {
    const parts = value.filter((v): v is string => typeof v === "string");
    return parts.length > 0 ? parts.join(", ") : null;
  }
  return null;
}
