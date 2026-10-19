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

function clearHighlights(container: HTMLElement) {
  const marks = container.querySelectorAll("mark.search-highlight");
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (parent) {
      parent.replaceChild(document.createTextNode(mark.textContent ?? ""), mark);
      parent.normalize();
    }
  }
}

function highlightMatches(container: HTMLElement, query: string): number {
  clearHighlights(container);
  if (!query) return 0;

  const lowerQuery = query.toLowerCase();
  let count = 0;

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

    const fragment = document.createDocumentFragment();
    let lastIdx = 0;

    while (idx !== -1) {
      if (idx > lastIdx) {
        fragment.appendChild(document.createTextNode(text.slice(lastIdx, idx)));
      }
      const mark = document.createElement("mark");
      mark.className = "search-highlight";
      mark.textContent = text.slice(idx, idx + query.length);
      fragment.appendChild(mark);
      count++;
      lastIdx = idx + query.length;
      idx = lowerText.indexOf(lowerQuery, lastIdx);
    }

    if (lastIdx < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastIdx)));
    }

    textNode.parentNode?.replaceChild(fragment, textNode);
  }

  return count;
}

function markActiveMatch(container: HTMLElement, index: number): Element | undefined {
  const marks = container.querySelectorAll("mark.search-highlight");
  for (const mark of marks) {
    mark.classList.remove("search-highlight-active");
  }
  const active = marks[index];
  active?.classList.add("search-highlight-active");
  return active;
}

function setActiveMatch(container: HTMLElement, index: number) {
  const active = markActiveMatch(container, index);
  active?.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
}

export function useSearch({ containerRef }: UseSearchOptions): UseSearchReturn {
  const [query, setQueryState] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const [currentMatch, setCurrentMatch] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const observerRef = useRef<MutationObserver>(undefined);
  const activeQuery = useRef("");
  const currentMatchRef = useRef(0);

  useEffect(() => {
    currentMatchRef.current = currentMatch;
  }, [currentMatch]);

  const runHighlight = useCallback(
    (q: string) => {
      const container = containerRef.current;
      if (!container) return;
      // The same query again is a refresh after the DOM changed, which keeps the user's place.
      const isRefresh = q === activeQuery.current;
      const preferredMatch = isRefresh ? currentMatchRef.current : 1;
      activeQuery.current = q;
      const count = highlightMatches(container, q);
      // Drop the records of these edits, or the observer would re-highlight for them forever.
      observerRef.current?.takeRecords();
      setMatchCount(count);
      if (count > 0) {
        const match = Math.min(Math.max(preferredMatch, 1), count);
        setCurrentMatch(match);
        // Keeping the same match doesn't scroll: the change may be a click elsewhere (a copy icon).
        const keepsPlace = isRefresh && match === preferredMatch;
        if (keepsPlace) markActiveMatch(container, match - 1);
        else setActiveMatch(container, match - 1);
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
    const container = containerRef.current;
    if (container) clearHighlights(container);
    activeQuery.current = "";
    setQueryState("");
    setMatchCount(0);
    setCurrentMatch(0);
  }, [containerRef]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Re-highlight when the content's DOM changes, not after every render: most change none of it.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let frame = 0;
    const observer = new MutationObserver(() => {
      if (!activeQuery.current) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => runHighlight(activeQuery.current));
    });
    observer.observe(container, { childList: true, characterData: true, subtree: true });
    observerRef.current = observer;
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [containerRef, runHighlight]);

  return { query, setQuery, matchCount, currentMatch, nextMatch, prevMatch, clear };
}
