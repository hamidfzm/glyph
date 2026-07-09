import type { Options } from "react-markdown";

type RehypePlugin = NonNullable<Options["rehypePlugins"]>[number];

// Cheap detector — false positives just mean highlight.js loads when it didn't
// have to. Matches any fenced code block (``` or ~~~) at the start of a line.
const CODE_BLOCK_PATTERN = /^(```|~~~)/m;

// Languages rendered by dedicated components (Mermaid diagrams, CSV tables),
// so highlight.js must leave their code blocks untouched. Shared between the
// live viewer's hook and the headless site exporter.
export const HIGHLIGHT_OPTIONS = { plainText: ["mermaid", "csv", "tsv"] };

let highlightPromise: Promise<RehypePlugin> | null = null;

export function hasCodeBlock(content: string): boolean {
  return CODE_BLOCK_PATTERN.test(content);
}

export function loadHighlight(): Promise<RehypePlugin> {
  if (!highlightPromise) {
    highlightPromise = import("rehype-highlight").then((mod) => mod.default as RehypePlugin);
  }
  return highlightPromise;
}
