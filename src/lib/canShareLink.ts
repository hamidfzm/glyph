import { isMarkdownFile } from "@/lib/markdownExtensions";
import type { FileState } from "@/lib/tabs";

/** A loaded markdown file, or an untitled document, which is always markdown. */
export function canShareLink(file: FileState | null | undefined): file is FileState {
  if (!file || file.content === null) return false;
  return file.virtual || isMarkdownFile(file.path);
}
