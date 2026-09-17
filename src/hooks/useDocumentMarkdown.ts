import { useSyncExternalStore } from "react";
import { fileTypes } from "@/lib/plugins/fileTypes";
import { isSourceDocument, sourceDocumentMarkdown } from "@/lib/sourceDocuments";

/**
 * The markdown a document renders as. Source documents (a `.d2` diagram, a
 * plugin file type) are fenced here, at render time, so enabling or disabling
 * the plugin that claims the extension re-renders an open tab in place.
 */
export function useDocumentMarkdown(filePath: string | undefined, content: string): string {
  useSyncExternalStore(fileTypes.subscribe, fileTypes.list);
  if (!filePath || !isSourceDocument(filePath)) return content;
  return sourceDocumentMarkdown(filePath, content);
}
