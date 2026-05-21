// `.mmd` is used by two different communities:
//
// - **Mermaid** diagram source files (raw flowcharts, sequence diagrams,
//   etc. that would otherwise live inside a ` ```mermaid ` fence).
// - **MultiMarkdown** documents — an extended markdown dialect; the file
//   itself is regular markdown text.
//
// We pick between them by sniffing the first non-comment, non-blank line:
// if it starts with one of Mermaid's diagram declarations we wrap the file
// in a mermaid fence so the existing renderer turns it into a diagram. If
// not, we render the content as markdown.

/** Diagram-declaration keywords Mermaid recognises at the top of a source. */
const MERMAID_DIAGRAM_KEYWORDS = [
  "flowchart",
  "graph",
  "sequenceDiagram",
  "classDiagram",
  "stateDiagram",
  "stateDiagram-v2",
  "erDiagram",
  "journey",
  "gantt",
  "pie",
  "mindmap",
  "timeline",
  "gitGraph",
  "requirementDiagram",
  "C4Context",
  "C4Container",
  "C4Component",
  "C4Dynamic",
  "C4Deployment",
  "quadrantChart",
  "xychart-beta",
  "block-beta",
  "sankey-beta",
  "packet-beta",
  "kanban",
  "architecture-beta",
] as const;

/**
 * Return the first content line of `text` after skipping blank lines and
 * Mermaid-style `%%` comments. Returns `null` if the document is entirely
 * empty / commented out.
 */
function firstMeaningfulLine(text: string): string | null {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (line.startsWith("%%")) continue;
    return line;
  }
  return null;
}

/**
 * Heuristic: does this raw text look like a Mermaid diagram source? We
 * match against the keyword followed by either whitespace or end-of-line,
 * so something like `flowchart TD` or just `pie` qualifies but a word in
 * prose like "graphical" does not.
 */
export function isMermaidContent(text: string): boolean {
  const line = firstMeaningfulLine(text);
  if (line === null) return false;
  for (const keyword of MERMAID_DIAGRAM_KEYWORDS) {
    if (
      line === keyword ||
      line.startsWith(`${keyword} `) ||
      line.startsWith(`${keyword}\t`)
    ) {
      return true;
    }
  }
  return false;
}

/** Wrap a Mermaid-source body so the markdown renderer can pick it up. */
export function wrapAsMermaid(text: string): string {
  return ["```mermaid", text.replace(/\s+$/u, ""), "```", ""].join("\n");
}

/**
 * `.mmd` files double as Mermaid diagram sources and MultiMarkdown text. If
 * the path is `.mmd` and the content sniffs as Mermaid, fence-wrap it so
 * the existing markdown viewer renders it as a diagram. Otherwise return
 * the original content unchanged.
 */
export function adaptMmdContent(path: string, content: string): string {
  if (!path.toLowerCase().endsWith(".mmd")) return content;
  if (!isMermaidContent(content)) return content;
  return wrapAsMermaid(content);
}
