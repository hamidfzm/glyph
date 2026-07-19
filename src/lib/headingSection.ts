// Slices the section under a markdown heading for `![[note#heading]]` embeds.
// A "section" is the matched heading line plus everything up to the next
// heading of the same or higher level. Matching is case-insensitive on either
// the trimmed heading text or its github-slugger slug, so both `note#My Heading`
// and `note#my-heading` resolve to the same section (the slug is what
// rehype-slug puts on the rendered anchor).
import { slug } from "github-slugger";
import { parseHeadings } from "@/lib/markdownHeadings";

function matches(heading: string, target: string): boolean {
  const a = heading.trim();
  const b = target.trim();
  return a.toLowerCase() === b.toLowerCase() || slug(a) === slug(b);
}

/**
 * Return the markdown section under `heading` within `md`, or an empty string
 * when no heading matches. Headings inside fenced code blocks are ignored.
 */
export function extractHeadingSection(md: string, heading: string): string {
  const headings = parseHeadings(md);
  const startIdx = headings.findIndex((h) => matches(h.text, heading));
  if (startIdx < 0) return "";

  const start = headings[startIdx];
  // Section runs to the next heading of the same or higher level.
  const end = headings.slice(startIdx + 1).find((h) => h.level <= start.level);

  const lines = md.split("\n");
  const section = lines.slice(start.line, end?.line);
  return section.join("\n").trimEnd();
}
