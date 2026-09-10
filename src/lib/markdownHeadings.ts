// Parse ATX headings from markdown, skipping fenced code blocks so that `#`
// comment lines inside ``` / ~~~ snippets are not mistaken for headings. Shared
// by the Outline sidebar (`useTableOfContents`), note-embed section slicing
// (`extractHeadingSection`), and export titles (`deriveExportMeta`).
// Opening sequence only: a `(.*)$` tail backtracks quadratically when `.` stops at `\r` or U+2028.
const ATX = /^(#{1,6})\s+/;
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
    // Drop a CommonMark closing sequence: a trailing `#` run alone or after whitespace (`# C#` keeps
    // it). Scanned by hand because a `$`-anchored regex backtracks quadratically on long whitespace.
    const rest = lines[i].slice(m[0].length).trimEnd();
    let runStart = rest.length;
    while (runStart > 0 && rest[runStart - 1] === "#") runStart--;
    const isClosing = runStart === 0 || /\s/.test(rest[runStart - 1]);
    const text = (isClosing ? rest.slice(0, runStart) : rest).trim();
    headings.push({ level: m[1].length, text, line: i });
  }

  return headings;
}
