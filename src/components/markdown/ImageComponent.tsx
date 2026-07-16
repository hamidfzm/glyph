import { type ComponentPropsWithoutRef, type SVGProps, useCallback } from "react";
import { MarkdownImage } from "./MarkdownImage";
import { SvgImage } from "./SvgImage";

// Binds the document's file path into the `img` component ReactMarkdown
// renders, so relative image paths resolve against the right directory. The
// workspace root used to constrain them is read from context by MarkdownImage.
export function useImageComponent(filePath: string | undefined) {
  return useCallback(
    (props: ComponentPropsWithoutRef<"img">) => <MarkdownImage {...props} filePath={filePath} />,
    [filePath],
  );
}

export function useSvgImageComponent(filePath: string | undefined) {
  return useCallback(
    (props: SVGProps<SVGImageElement>) => <SvgImage {...props} filePath={filePath} />,
    [filePath],
  );
}
