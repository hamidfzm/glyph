import { useEffect, useState } from "react";
import type { Options } from "react-markdown";
import { hasEmojiShortcode, loadGemoji } from "@/components/markdown/lazyGemoji";

type RemarkPlugin = NonNullable<Options["remarkPlugins"]>[number];

/**
 * Lazily loads `remark-gemoji` the first time `content` contains an emoji
 * shortcode. Returns `null` until the plugin is ready or if none is present.
 */
export function useGemojiPlugin(content: string): RemarkPlugin | null {
  const contentHasShortcode = hasEmojiShortcode(content);
  const [plugin, setPlugin] = useState<RemarkPlugin | null>(null);

  useEffect(() => {
    if (!contentHasShortcode) return;
    let cancelled = false;
    loadGemoji().then((p) => {
      if (!cancelled) setPlugin(() => p);
    });
    return () => {
      cancelled = true;
    };
  }, [contentHasShortcode]);

  return contentHasShortcode ? plugin : null;
}
