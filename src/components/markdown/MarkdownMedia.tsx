import type { ComponentPropsWithoutRef } from "react";
import type { ExtraProps } from "react-markdown";
import { useWorkspaceRoot } from "@/contexts/TabsContext";
import { resolveAssetRef } from "./resolveImageSrc";

interface MarkdownMediaProps extends ComponentPropsWithoutRef<"video">, ExtraProps {
  filePath: string | undefined;
  tag: "video" | "audio";
}

// Whether any <source> child resolves. Read from the hast node rather than the
// rendered children: a MarkdownMediaSource whose src was refused still counts as
// a React element, so counting children would keep an unplayable element alive.
function hasPlayableSource(
  node: ExtraProps["node"],
  filePath: string | undefined,
  root: string | undefined,
): boolean {
  return (node?.children ?? []).some((child) => {
    if (child.type !== "element" || child.tagName !== "source") return false;
    const src = child.properties?.src;
    return typeof src === "string" && resolveAssetRef(src, filePath, root).src !== undefined;
  });
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
  node,
  ...rest
}: MarkdownMediaProps) {
  const workspaceRoot = useWorkspaceRoot();
  const media = resolveAssetRef(src, filePath, workspaceRoot);
  const posterFrame = resolveAssetRef(poster, filePath, workspaceRoot);

  // Nothing to play: a refused src and no <source> child that resolved either.
  if (!media.src && !hasPlayableSource(node, filePath, workspaceRoot)) return null;

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
