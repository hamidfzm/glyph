import { Children, type ComponentPropsWithoutRef, isValidElement } from "react";
import { useWorkspaceRoot } from "@/contexts/TabsContext";
import { resolveAssetRef } from "./resolveImageSrc";

interface MarkdownMediaProps extends ComponentPropsWithoutRef<"video"> {
  filePath: string | undefined;
  tag: "video" | "audio";
}

// A markdown <video>/<audio> with its src and poster resolved for the webview.
// Both are constrained to the workspace by resolveAssetRef, so a reference that
// escapes the opened folder renders nothing at all.
export function MarkdownMedia({
  filePath,
  tag: Tag,
  src,
  poster,
  children,
  ...rest
}: MarkdownMediaProps) {
  const workspaceRoot = useWorkspaceRoot();
  const media = resolveAssetRef(src, filePath, workspaceRoot);
  const posterFrame = resolveAssetRef(poster, filePath, workspaceRoot);

  // Nothing to play: a refused src and no <source> child that resolved either.
  // Whitespace between the tags is a child too, hence the element filter.
  const sources = Children.toArray(children).filter(isValidElement);
  if (!media.src && sources.length === 0) return null;

  return (
    <Tag
      {...rest}
      src={media.src}
      // The sanitizer keeps `poster` off <audio>, so it resolves to undefined
      // there and React omits it.
      poster={posterFrame.src}
      // Decoding runs in the OS media stack, a far larger parsing surface than
      // the image decoders, so an untrusted container stays unparsed until the
      // user presses play. With `autoplay` sanitized away, controls are then
      // the only way to start it.
      preload="none"
      controls
      // Absolute source path for the exporters, which strip it from output.
      data-media-path={media.path}
    >
      {children}
    </Tag>
  );
}
