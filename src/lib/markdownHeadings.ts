// Parse ATX headings from markdown, skipping fenced code blocks so that `#`
// comment lines inside ``` / ~~~ snippets are not mistaken for headings. Shared
// by the Outline sidebar (`useTableOfContents`) and note-embed section slicing
// (`extractHeadingSection`).
const ATX = /^(#{1,6})\s+(.*)$/;
const FENCE = /^\s{0,3}(```+|~~~+)/;

export interface MarkdownHeading {
  level: number;
  text: string;
  /** 0-based index into `md.split("\n")`. */
  line: number;
}

export function parseHeadings(md: string): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  const lines = md.split("\n");
  let fence: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const fenceMatch = lines[i].match(FENCE);
    if (fenceMatch) {
      // ponytail: match on fence char only, not run length; nested longer
      // fences (```` wrapping ```) close early. Track length if that ever bites.
      const marker = fenceMatch[1][0];
      if (fence === null) fence = marker;
      else if (marker === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;

    const m = ATX.exec(lines[i]);
    if (!m) continue;
    // Drop a trailing run of `#` (closed ATX headings) and surrounding space.
    const text = m[2].replace(/\s+#+\s*$/, "").trim();
    headings.push({ level: m[1].length, text, line: i });
  }

  return headings;
}
