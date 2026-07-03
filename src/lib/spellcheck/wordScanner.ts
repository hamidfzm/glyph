import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

export interface WordToken {
  from: number;
  to: number;
  word: string;
}

// Lezer-markdown node names whose text must never be spell checked: code in any
// form, link targets, and raw HTML. Prose lives outside these.
const EXCLUDED_NODES = new Set([
  "FencedCode",
  "CodeBlock",
  "CodeText",
  "InlineCode",
  "URL",
  "Autolink",
  "HTMLBlock",
  "HTMLTag",
  "Comment",
  "CommentBlock",
]);

// Letters (incl. combining marks) with internal apostrophes and hyphens, so
// "don't" and "well-being" stay single tokens. No digits, so "utf8" won't match
// as one word.
const WORD_RE = /\p{L}[\p{L}\p{M}'’]*(?:-\p{L}[\p{L}\p{M}'’]*)*/gu;

function isAllCaps(word: string): boolean {
  return word === word.toUpperCase() && word !== word.toLowerCase();
}

function overlapsAny(from: number, to: number, ranges: [number, number][]): boolean {
  return ranges.some(([start, end]) => from < end && to > start);
}

// YAML frontmatter (a leading `---` fence) is not modelled by the base markdown
// parser, so detect it directly and exclude the whole block.
function frontmatterRange(state: EditorState): [number, number] | null {
  const doc = state.doc;
  if (doc.lines < 2 || doc.line(1).text !== "---") return null;
  for (let n = 2; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (line.text === "---" || line.text === "...") return [0, line.to];
  }
  return null;
}

// Collect prose word tokens in [from, to], skipping code/links/HTML/frontmatter,
// acronyms (all-caps), and single letters.
export function scanWords(state: EditorState, from: number, to: number): WordToken[] {
  const exclusions: [number, number][] = [];
  const frontmatter = frontmatterRange(state);
  if (frontmatter && from < frontmatter[1] && to > frontmatter[0]) {
    exclusions.push(frontmatter);
  }

  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (EXCLUDED_NODES.has(node.name)) exclusions.push([node.from, node.to]);
    },
  });

  const text = state.doc.sliceString(from, to);
  const tokens: WordToken[] = [];
  for (const match of text.matchAll(WORD_RE)) {
    const word = match[0];
    if (word.length < 2 || isAllCaps(word)) continue;
    const start = from + (match.index ?? 0);
    const end = start + word.length;
    if (overlapsAny(start, end, exclusions)) continue;
    tokens.push({ from: start, to: end, word });
  }
  return tokens;
}
