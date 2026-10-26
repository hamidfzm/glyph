// Rewrite one fenced code block's body in markdown source, for a plugin
// renderer saving its block. Like toggleTaskAtLine, this edits the source text
// so everything around the block keeps its exact bytes.

/** A rendered fenced block: its source lines (1-based, fences included) and the body it showed. */
export interface FencedBlock {
  startLine: number;
  endLine: number;
  /** The body as the renderer received it, trimmed. */
  code: string;
}

// The part before the fence is the container the block sits in: blockquote
// markers, indentation, and the marker of the list item it opens.
const OPENING_FENCE = /^((?:[ \t>]|[-*+][ \t]|\d{1,9}[.)][ \t])*?)(`{3,}|~{3,})(.*)$/;
const LIST_MARKER = /[-*+]|\d{1,9}[.)]/g;
const LINE_END = /\r\n|\r|\n/g;

/** Lines without their endings, and each line's own ending ("" for the last). */
function splitLines(source: string): { lines: string[]; ends: string[] } {
  const lines: string[] = [];
  const ends: string[] = [];
  let at = 0;
  for (const match of source.matchAll(LINE_END)) {
    lines.push(source.slice(at, match.index));
    ends.push(match[0]);
    at = match.index + match[0].length;
  }
  lines.push(source.slice(at));
  ends.push("");
  return { lines, ends };
}

/** `code` as lines, line endings normalized and trailing blank lines dropped. */
function codeLines(code: string): string[] {
  const trimmed = code.replace(/[\r\n]+$/, "");
  return trimmed === "" ? [] : trimmed.split(/\r\n|\r|\n/);
}

// Body lines repeat a blockquote prefix exactly (a blank one may drop its
// trailing space), while indentation is stripped up to the fence's own.
function stripContainer(line: string, prefix: string): string | null {
  if (!prefix.includes(">")) {
    return line.replace(new RegExp(`^[ \\t]{0,${prefix.length}}`), "");
  }
  if (line.startsWith(prefix)) return line.slice(prefix.length);
  const bare = prefix.trimEnd();
  if (line.startsWith(bare) && line.slice(bare.length).trim() === "") return "";
  return null;
}

function isClosingFence(line: string, char: string, length: number): boolean {
  const match = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
  return match !== null && match[1][0] === char && match[1].length >= length;
}

// A body line opening with a run of the fence character at least as long as
// the fence would close the block early, so the fence must outgrow it.
function fenceLengthFor(lines: readonly string[], char: string, length: number): number {
  let longest = 0;
  for (const line of lines) {
    const run = /^[ \t]{0,3}(`+|~+)/.exec(line)?.[1];
    if (run?.[0] === char && run.length > longest) longest = run.length;
  }
  return longest >= length ? longest + 1 : length;
}

/**
 * `source` with the body of `block` replaced by `code`, or null when the lines
 * no longer hold that block (the text changed since it rendered).
 */
export function replaceFencedBlockBody(
  source: string,
  block: FencedBlock,
  code: string,
): string | null {
  const bom = source.startsWith("﻿") ? "﻿" : "";
  const { lines, ends } = splitLines(source.slice(bom.length));
  const start = block.startLine - 1;
  const end = block.endLine - 1;
  if (start < 0 || end < start || end >= lines.length) return null;

  const opening = OPENING_FENCE.exec(lines[start]);
  if (!opening) return null;
  const [, prefix, fence, info] = opening;
  const char = fence[0];
  // The item's later lines sit under its content, so its marker reads as spaces.
  const bodyPrefix = prefix.replace(LIST_MARKER, (marker) => " ".repeat(marker.length));

  const stripped: string[] = [];
  for (let i = start + 1; i <= end; i++) {
    const line = stripContainer(lines[i], bodyPrefix);
    if (line === null) return null;
    stripped.push(line);
  }
  const last = stripped.at(-1);
  const closed = last !== undefined && isClosingFence(last, char, fence.length);
  const body = closed ? stripped.slice(0, -1) : stripped;
  if (body.join("\n").trim() !== codeLines(block.code).join("\n").trim()) return null;

  const nextBody = codeLines(code);
  const nextFence = char.repeat(fenceLengthFor(nextBody, char, fence.length));
  const contained = (line: string) => (line === "" ? bodyPrefix.trimEnd() : bodyPrefix + line);
  const replacement = [
    `${prefix}${nextFence}${info}`,
    ...nextBody.map(contained),
    ...(closed ? [contained(nextFence)] : []),
  ];
  // New lines take the block's own line ending; the last keeps whatever
  // followed the block, so the text after it is untouched.
  const eol = ends[start] || "\n";
  const replacementEnds = replacement.map((_, i) =>
    i === replacement.length - 1 ? ends[end] : eol,
  );
  lines.splice(start, end - start + 1, ...replacement);
  ends.splice(start, end - start + 1, ...replacementEnds);
  return bom + lines.map((line, i) => line + ends[i]).join("");
}

/**
 * A source document (a file that renders as one fenced block) with its whole
 * text replaced by `code`, or null when it no longer holds the code the block
 * rendered. Keeps the file's BOM, line endings, and final newline.
 */
export function replaceSourceDocument(
  content: string,
  current: string,
  code: string,
): string | null {
  const bom = content.startsWith("﻿") ? "﻿" : "";
  const text = content.slice(bom.length);
  if (codeLines(text).join("\n").trim() !== codeLines(current).join("\n").trim()) return null;
  const eol = text.match(LINE_END)?.[0] ?? "\n";
  const finalNewline = /[\r\n]$/.test(text) ? eol : "";
  return bom + codeLines(code).join(eol) + finalNewline;
}
