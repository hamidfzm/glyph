import type { ComponentPropsWithoutRef } from "react";
import type { ExtraProps } from "react-markdown";
import { useAssetRef } from "@/hooks/useAssetRef";

interface MarkdownMediaSourceProps extends ComponentPropsWithoutRef<"source">, ExtraProps {
  filePath: string | undefined;
}

// A <source> inside a markdown <video>/<audio>. It resolves its own src rather
// than being rewritten by the parent, so the same workspace-root clamp applies
// to every URL a media element can reach.
export function MarkdownMediaSource({
  filePath,
  src,
  node: _node,
  ...rest
}: MarkdownMediaSourceProps) {
  const resolved = useAssetRef(src, filePath);
  if (!resolved.src) return null;
  return <source {...rest} src={resolved.src} data-media-path={resolved.path} />;
}
