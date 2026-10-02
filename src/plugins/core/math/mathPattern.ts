// Cheap detector: a false positive only loads KaTeX early, never renders
// wrong. Matches $...$, $$...$$, \(...\), \[...\].
const MATH_PATTERN = /\$\$[\s\S]+?\$\$|(?<!\\)\$[^\n$]+?\$|\\\(|\\\[/;

export function hasMath(markdown: string): boolean {
  return MATH_PATTERN.test(markdown);
}
