import type { ComponentPropsWithoutRef } from "react";
import type { ExtraProps } from "react-markdown";
import { useWorkspaceRoot } from "@/contexts/TabsContext";
import { resolveAssetRef } from "./resolveImageSrc";

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
  const workspaceRoot = useWorkspaceRoot();
  const resolved = resolveAssetRef(src, filePath, workspaceRoot);
  if (!resolved.src) return null;
  return <source {...rest} src={resolved.src} data-media-path={resolved.path} />;
}
