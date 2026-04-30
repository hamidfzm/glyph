import { useEffect, useState } from "react";
import type { Options } from "react-markdown";
import { hasMath, loadKatex } from "../components/markdown/lazyKatex";

type RehypePlugin = NonNullable<Options["rehypePlugins"]>[number];

/**
 * Lazily loads `rehype-katex` (and its CSS) the first time `content` contains
 * math. Returns `null` until the plugin is ready or if no math is present.
 */
export function useKatexPlugin(content: string): RehypePlugin | null {
  const contentHasMath = hasMath(content);
  const [plugin, setPlugin] = useState<RehypePlugin | null>(null);

  useEffect(() => {
    if (!contentHasMath) return;
    let cancelled = false;
    loadKatex().then((p) => {
      if (!cancelled) setPlugin(() => p);
    });
    return () => {
      cancelled = true;
    };
  }, [contentHasMath]);

  return contentHasMath ? plugin : null;
}
