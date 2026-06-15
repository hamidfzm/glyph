import { type ComponentPropsWithoutRef, useCallback } from "react";
import { MarkdownImage } from "./MarkdownImage";

// Binds the document's file path into the `img` component ReactMarkdown
// renders, so relative image paths resolve against the right directory.
export function useImageComponent(filePath: string | undefined) {
  return useCallback(
    (props: ComponentPropsWithoutRef<"img">) => <MarkdownImage {...props} filePath={filePath} />,
    [filePath],
  );
}
