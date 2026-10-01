import { useEffect, useReducer, useRef } from "react";
import { loadForDocument, type RehypeContribution, readyPlugins } from "@/lib/markdown/lazyPlugins";
import type { MarkdownPlugin } from "@/lib/plugins/types";

/**
 * The rehype contributions ready for `content`: lazy ones `content` needs start
 * loading, and the document re-renders with each one as it lands.
 */
export function useLazyMarkdownPlugins(
  entries: readonly RehypeContribution[],
  content: string,
): MarkdownPlugin[] {
  const [, landed] = useReducer((count: number) => count + 1, 0);
  const ready = readyPlugins(entries);
  // What this render used, so a load that landed meanwhile (for this document
  // or another one) still re-renders it.
  const rendered = useRef(ready);
  rendered.current = ready;

  useEffect(() => {
    let live = true;
    void loadForDocument(entries, content).then(() => {
      if (live && readyPlugins(entries) !== rendered.current) landed();
    });
    return () => {
      live = false;
    };
  }, [entries, content]);

  return ready;
}
