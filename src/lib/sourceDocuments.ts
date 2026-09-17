// Source documents: files whose whole body is the source of one fenced block,
// such as a `.d2` diagram. They open read-only and render as that block, so the
// renderer comes from whichever plugin claims the extension.

import { isD2File } from "@/lib/d2Extensions";
import { fileTypeFor } from "@/lib/plugins/fileTypes";

/**
 * A plugin file type, or a `.d2` file. `.d2` is an OS file association fixed
 * at build time, so it stays openable while the plugin that renders it is off.
 */
export function isSourceDocument(path: string): boolean {
  return isD2File(path) || fileTypeFor(path) !== undefined;
}

/**
 * The markdown a source document renders as: its body in one fence tagged with
 * the registered file type's language, or untagged (plain source) when no
 * enabled plugin claims the extension. The fence is longer than any backtick
 * run in the body so the body cannot close it.
 */
export function sourceDocumentMarkdown(path: string, source: string): string {
  const language = fileTypeFor(path)?.language ?? "";
  const longestRun = Math.max(0, ...(source.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return [`${fence}${language}`, source.replace(/\s+$/u, ""), fence, ""].join("\n");
}
