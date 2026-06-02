// Wrap source text in a fenced markdown code block so it can be handed to the
// markdown renderer for syntax highlighting. The fence is always longer than
// any backtick run inside the source, so code (or JSON) containing ``` can't
// break out of the block. Shared by the notebook code-cell renderer and the
// read-only notebook source view.
export function fenceCode(source: string, lang: string): string {
  const longestRun = (source.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}${lang}\n${source}\n${fence}`;
}
