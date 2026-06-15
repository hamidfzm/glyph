import { type ComponentPropsWithoutRef, useRef } from "react";
import { useLightbox } from "@/contexts/LightboxContext";
import { resolveImageSrc } from "./resolveImageSrc";

interface MarkdownImageProps extends ComponentPropsWithoutRef<"img"> {
  filePath: string | undefined;
}

// A markdown <img> with its src resolved for the webview. When a lightbox
// provider is in scope the image is wrapped in a button that opens the lightbox
// on click or Enter/Space; without one it renders as a plain image (e.g.
// printing, notebook export).
export function MarkdownImage({ filePath, src, alt, ...rest }: MarkdownImageProps) {
  const lightbox = useLightbox();
  const imgRef = useRef<HTMLImageElement>(null);
  const resolved = resolveImageSrc(src, filePath);

  if (!lightbox || !resolved) {
    return <img src={resolved} alt={alt} {...rest} />;
  }

  return (
    <button
      type="button"
      className="markdown-image-button"
      aria-label={alt ? `View image: ${alt}` : "View image"}
      onClick={() => {
        if (imgRef.current) lightbox.open(imgRef.current);
      }}
    >
      <img ref={imgRef} src={resolved} alt={alt} {...rest} data-zoomable="true" />
    </button>
  );
}
