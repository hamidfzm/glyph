import type { ComponentPropsWithoutRef, MouseEvent } from "react";
import { useLightbox } from "@/contexts/LightboxContext";
import { useWorkspaceRoot } from "@/contexts/WorkspaceRootContext";
import { resolveImageSrc } from "./resolveImageSrc";

interface MarkdownImageProps extends ComponentPropsWithoutRef<"img"> {
  filePath: string | undefined;
}

// A markdown <img> with its src resolved for the webview. When a lightbox
// provider is in scope, clicking the image opens it. The handler lives on the
// image itself (no wrapper element) so it renders identically to a plain image
// and stays valid inside a linked image (<a>). Without a provider it renders as
// a plain image (e.g. printing, export).
export function MarkdownImage({ filePath, src, alt, ...rest }: MarkdownImageProps) {
  const lightbox = useLightbox();
  const workspaceRoot = useWorkspaceRoot();
  const resolved = resolveImageSrc(src, filePath, workspaceRoot);

  if (!lightbox || !resolved) {
    return <img src={resolved} alt={alt} {...rest} />;
  }

  const handleClick = (event: MouseEvent<HTMLImageElement>) => {
    // Win over an enclosing link so a linked image zooms instead of navigating.
    event.preventDefault();
    event.stopPropagation();
    lightbox.open(event.currentTarget);
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: a markdown image is a click-to-zoom trigger and stays a plain <img> so it renders identically and remains valid inside a linked image (<a>); the lightbox itself is fully keyboard-operable once open (Esc, arrows, +/-)
    <img src={resolved} alt={alt} {...rest} data-zoomable="true" onClick={handleClick} />
  );
}
