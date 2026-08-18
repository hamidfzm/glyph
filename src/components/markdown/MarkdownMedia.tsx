import type { ComponentPropsWithoutRef } from "react";
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

  // Nothing to play: a refused src with no <source> children of its own.
  if (!media.src && !children) return null;

  return (
    <Tag
      {...rest}
      src={media.src}
      // Only <video> carries a poster: the sanitizer keeps the attribute off
      // <audio>, so this resolves to undefined there and React omits it.
      poster={posterFrame.src}
      // Media decoding runs in the OS media stack, a far larger parsing surface
      // than the image decoders, so an untrusted container stays unparsed until
      // the user presses play.
      preload="none"
      // The sanitizer drops `autoplay`, so without controls a media element
      // could never be played at all.
      controls
      // Absolute source path for the exporters, which strip it from output.
      data-media-path={media.path}
      data-poster-path={posterFrame.path}
    >
      {children}
    </Tag>
  );
}
