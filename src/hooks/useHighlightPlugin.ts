import { useEffect, useState } from "react";
import type { Options } from "react-markdown";
import { hasCodeBlock, loadHighlight } from "@/components/markdown/lazyHighlight";

type RehypePlugin = NonNullable<Options["rehypePlugins"]>[number];

const HIGHLIGHT_OPTIONS = { plainText: ["mermaid"] };

/**
 * Lazily loads `rehype-highlight` the first time `content` contains a fenced
 * code block. Returns `null` until the plugin is ready or if no code is present.
 */
export function useHighlightPlugin(content: string): RehypePlugin | null {
  const contentHasCode = hasCodeBlock(content);
  const [plugin, setPlugin] = useState<RehypePlugin | null>(null);

  useEffect(() => {
    if (!contentHasCode) return;
    let cancelled = false;
    loadHighlight().then((p) => {
      if (!cancelled) setPlugin(() => [p, HIGHLIGHT_OPTIONS] as RehypePlugin);
    });
    return () => {
      cancelled = true;
    };
  }, [contentHasCode]);

  return contentHasCode ? plugin : null;
}
