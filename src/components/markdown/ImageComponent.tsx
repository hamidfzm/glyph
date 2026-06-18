import { type ComponentPropsWithoutRef, useCallback } from "react";
import { MarkdownImage } from "./MarkdownImage";

// Binds the document's file path (and the opened workspace root) into the `img`
// component ReactMarkdown renders, so relative image paths resolve against the
// right directory and stay constrained to the workspace folder.
export function useImageComponent(filePath: string | undefined, workspaceRoot?: string) {
  return useCallback(
    (props: ComponentPropsWithoutRef<"img">) => (
      <MarkdownImage {...props} filePath={filePath} workspaceRoot={workspaceRoot} />
    ),
    [filePath, workspaceRoot],
  );
}
