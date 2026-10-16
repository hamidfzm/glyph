import type { ComponentProps } from "react";
import { AIImagePlaceholder } from "./AIImagePlaceholder";

interface AIReplyImageProps extends ComponentProps<"img"> {
  /** Image URLs the document named when the reply was requested. */
  quotedUrls: readonly string[];
}

// A reply image loads only when the document already named its URL: a quoted
// URL carries nothing the note did not, so loading it leaks nothing the
// document view would not. Anything the model composed stays text.
export function AIReplyImage({ quotedUrls, src, alt }: AIReplyImageProps) {
  if (src && quotedUrls.includes(src)) {
    return <img src={src} alt={alt} />;
  }
  return <AIImagePlaceholder src={src} alt={alt} />;
}
