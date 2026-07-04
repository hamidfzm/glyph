// Slices the section under a markdown heading for `![[note#heading]]` embeds.
// A "section" is the matched heading line plus everything up to the next
// heading of the same or higher level. Matching is case-insensitive on either
// the trimmed heading text or its github-slugger slug, so both `note#My Heading`
// and `note#my-heading` resolve to the same section (the slug is what
// rehype-slug puts on the rendered anchor).
import { slug } from "github-slugger";

const ATX = /^(#{1,6})\s+(.*)$/;
const FENCE = /^(```|~~~)/;

interface Heading {
  level: number;
  text: string;
}

function parseHeading(line: string): Heading | null {
  const m = ATX.exec(line);
  if (!m) return null;
  // Drop a trailing run of `#` (closed ATX headings) and surrounding space.
  const text = m[2].replace(/\s+#+\s*$/, "").trim();
  return { level: m[1].length, text };
}

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
  const lines = md.split("\n");
  let inFence = false;
  let startLevel = -1;
  const out: string[] = [];

  for (const line of lines) {
    if (FENCE.test(line)) {
      // Toggle fence state; a fenced line is never a heading.
      if (startLevel >= 0) out.push(line);
      inFence = !inFence;
      continue;
    }

    const h = inFence ? null : parseHeading(line);

    if (startLevel < 0) {
      if (h && matches(h.text, heading)) {
        startLevel = h.level;
        out.push(line);
      }
      continue;
    }

    // Collecting: stop at the next same-or-higher heading.
    if (h && h.level <= startLevel) break;
    out.push(line);
  }

  return startLevel < 0 ? "" : out.join("\n").trimEnd();
}
