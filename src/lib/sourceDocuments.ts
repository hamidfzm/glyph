// Source documents: files whose whole body is the source of one fenced block,
// such as a `.d2` diagram. They open read-only and render as that block, so the
// renderer comes from whichever plugin claims the extension.

import { isD2File } from "@/lib/d2Extensions";
import { fileTypeFor, fileTypes } from "@/lib/plugins/fileTypes";
import type { FileTypeContribution } from "@/lib/plugins/types";

/**
 * A plugin file type, or a `.d2` file. `.d2` is an OS file association fixed
 * at build time, so it stays openable while the plugin that renders it is off.
 */
export function isSourceDocument(
  path: string,
  registered: readonly FileTypeContribution[] = fileTypes.list(),
): boolean {
  return isD2File(path) || fileTypeFor(path, registered) !== undefined;
}

function longestBacktickRun(text: string): number {
  let longest = 0;
  let run = 0;
  for (const char of text) {
    run = char === "`" ? run + 1 : 0;
    if (run > longest) longest = run;
  }
  return longest;
}

/**
 * A source document's body as one fenced block tagged `language` (untagged
 * shows plain source). The fence is longer than any backtick run in the body
 * so the body cannot close it.
 */
export function fenceSource(source: string, language: string): string {
  const fence = "`".repeat(Math.max(3, longestBacktickRun(source) + 1));
  return [`${fence}${language}`, source.trimEnd(), fence, ""].join("\n");
}
