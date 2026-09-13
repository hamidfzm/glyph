import type { ComponentPropsWithoutRef } from "react";
import type { ExtraProps } from "react-markdown";
import { useWorkspaceRoot } from "@/contexts/TabsContext";
import { useAssetRef } from "@/hooks/useAssetRef";
import { mediaLabel } from "@/lib/mediaExtensions";
import { clampRootFor } from "@/lib/relativePath";
import { resolveAssetRef } from "./resolveAssetRef";

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
// Inside a workspace both are clamped to its root, so a reference that escapes
// the folder renders nothing at all; beside a loose file the backend decides.
export function MarkdownMedia({
  filePath,
  tag: Tag,
  src,
  poster,
  children,
  node,
  ...rest
}: MarkdownMediaProps) {
  const root = clampRootFor(filePath, useWorkspaceRoot());
  const media = useAssetRef(src, filePath);
  const posterFrame = useAssetRef(poster, filePath);

  // Nothing to play: a refused src and no <source> child that resolved either.
  if (!media.src && !hasPlayableSource(node, filePath, root)) return null;

  // Named from what actually resolved: an element kept alive by a <source>
  // child has no name of its own, and a refused src must not be printed as
  // though it were the thing playing.
  const printName = media.src ? mediaLabel(media.path, src) : "";

  return (
    <>
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
      {/* Paper cannot play a file either, and a player with no poster prints as
          an empty box. The exporters strip this and emit their own name, so the
          document never carries it twice. */}
      {printName && (
        <span className="markdown-media-print" data-export-ignore>
          {printName}
        </span>
      )}
    </>
  );
}
