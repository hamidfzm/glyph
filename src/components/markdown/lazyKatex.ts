import type { Options } from "react-markdown";

type RehypePlugin = NonNullable<Options["rehypePlugins"]>[number];

// Cheap detector — false positives just mean KaTeX loads when it didn't have to,
// not a correctness problem. Matches $...$, $$...$$, \(...\), \[...\].
const MATH_PATTERN = /\$\$[\s\S]+?\$\$|(?<!\\)\$[^\n$]+?\$|\\\(|\\\[/;

let katexPromise: Promise<RehypePlugin> | null = null;

export function hasMath(content: string): boolean {
  return MATH_PATTERN.test(content);
}

export function loadKatex(): Promise<RehypePlugin> {
  if (!katexPromise) {
    katexPromise = Promise.all([import("rehype-katex"), import("katex/dist/katex.min.css")]).then(
      ([mod]) => mod.default as RehypePlugin,
    );
  }
  return katexPromise;
}
