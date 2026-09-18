import { useMemo, useSyncExternalStore } from "react";
import { isMarkdownFile } from "@/lib/markdownExtensions";
import { fileTypeFor, fileTypes } from "@/lib/plugins/fileTypes";
import { fenceSource } from "@/lib/sourceDocuments";

/**
 * The markdown a document renders as. Anything outside the markdown family (a
 * `.d2` diagram, a plugin file type, or one whose plugin was just disabled) is
 * fenced here, at render time, so it never renders as markdown, and toggling
 * the plugin that claims it re-renders an open tab in place.
 */
export function useDocumentMarkdown(filePath: string | undefined, content: string): string {
  const registered = useSyncExternalStore(fileTypes.subscribe, fileTypes.list);
  return useMemo(() => {
    if (!filePath || isMarkdownFile(filePath)) return content;
    return fenceSource(content, fileTypeFor(filePath, registered)?.language ?? "");
  }, [filePath, content, registered]);
}
