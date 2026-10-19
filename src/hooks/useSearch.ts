import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { scrollBehavior } from "@/lib/reducedMotion";

interface UseSearchOptions {
  containerRef: RefObject<HTMLDivElement | null>;
}

interface UseSearchReturn {
  query: string;
  setQuery: (q: string) => void;
  matchCount: number;
  currentMatch: number;
  nextMatch: () => void;
  prevMatch: () => void;
  clear: () => void;
}

// React keeps using the text nodes it rendered, so a match leaves the node in place, emptied.
interface SplitText {
  node: Text;
  text: string;
  pieces: ChildNode[];
}

function restoreText(splits: SplitText[]) {
  for (const { node, text, pieces } of splits) {
    for (const piece of pieces) piece.remove();
    // React renders no empty text node here, so any other value is newer text it wrote.
    if (node.nodeValue === "") node.nodeValue = text;
  }
}

function highlightMatches(container: HTMLElement, query: string): SplitText[] {
  if (!query) return [];

  const lowerQuery = query.toLowerCase();
  const splits: SplitText[] = [];

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (
        parent?.closest(
          "mark.search-highlight, script, style, .mermaid-diagram, .markdown-media-print",
        )
      ) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const textNodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    textNodes.push(node as Text);
    node = walker.nextNode();
  }

  for (const textNode of textNodes) {
    const text = textNode.textContent ?? "";
    const lowerText = text.toLowerCase();
    let idx = lowerText.indexOf(lowerQuery);
    if (idx === -1) continue;

    const pieces: ChildNode[] = [];
    let lastIdx = 0;

    while (idx !== -1) {
      if (idx > lastIdx) {
        pieces.push(document.createTextNode(text.slice(lastIdx, idx)));
      }
      const mark = document.createElement("mark");
      mark.className = "search-highlight";
      mark.textContent = text.slice(idx, idx + query.length);
      pieces.push(mark);
      lastIdx = idx + query.length;
      idx = lowerText.indexOf(lowerQuery, lastIdx);
    }

    if (lastIdx < text.length) {
      pieces.push(document.createTextNode(text.slice(lastIdx)));
    }

    textNode.after(...pieces);
    textNode.nodeValue = "";
    splits.push({ node: textNode, text, pieces });
  }

  return splits;
}

function setActiveMatch(container: HTMLElement, index: number) {
  const marks = container.querySelectorAll("mark.search-highlight");
  for (const mark of marks) {
    mark.classList.remove("search-highlight-active");
  }
  const active = marks[index];
  if (active) {
    active.classList.add("search-highlight-active");
    active.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
  }
}

export function useSearch({ containerRef }: UseSearchOptions): UseSearchReturn {
  const [query, setQueryState] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const [currentMatch, setCurrentMatch] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const activeQuery = useRef("");
  const splitsRef = useRef<SplitText[]>([]);

  const runHighlight = useCallback(
    (q: string) => {
      const container = containerRef.current;
      if (!container) return;
      activeQuery.current = q;
      restoreText(splitsRef.current);
      splitsRef.current = highlightMatches(container, q);
      const count = container.querySelectorAll("mark.search-highlight").length;
      setMatchCount(count);
      if (count > 0) {
        setCurrentMatch(1);
        setActiveMatch(container, 0);
      } else {
        setCurrentMatch(0);
      }
    },
    [containerRef],
  );

  const setQuery = useCallback(
    (q: string) => {
      setQueryState(q);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => runHighlight(q), 150);
    },
    [runHighlight],
  );

  const nextMatch = useCallback(() => {
    const container = containerRef.current;
    if (!container || matchCount === 0) return;
    const next = currentMatch >= matchCount ? 1 : currentMatch + 1;
    setCurrentMatch(next);
    setActiveMatch(container, next - 1);
  }, [containerRef, matchCount, currentMatch]);

  const prevMatch = useCallback(() => {
    const container = containerRef.current;
    if (!container || matchCount === 0) return;
    const prev = currentMatch <= 1 ? matchCount : currentMatch - 1;
    setCurrentMatch(prev);
    setActiveMatch(container, prev - 1);
  }, [containerRef, matchCount, currentMatch]);

  const clear = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    restoreText(splitsRef.current);
    splitsRef.current = [];
    activeQuery.current = "";
    setQueryState("");
    setMatchCount(0);
    setCurrentMatch(0);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Re-highlight when content changes (React re-renders the DOM)
  useEffect(() => {
    if (!activeQuery.current) return;
    const q = activeQuery.current;
    requestAnimationFrame(() => {
      runHighlight(q);
    });
  });

  return { query, setQuery, matchCount, currentMatch, nextMatch, prevMatch, clear };
}
