import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

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
      if (parent?.closest("mark.search-highlight, script, style, .mermaid-diagram")) {
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

function setActiveMatch(container: HTMLElement, index: number) {
  const marks = container.querySelectorAll("mark.search-highlight");
  for (const mark of marks) {
    mark.classList.remove("search-highlight-active");
  }
  const active = marks[index];
  if (active) {
    active.classList.add("search-highlight-active");
    active.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

export function useSearch({ containerRef }: UseSearchOptions): UseSearchReturn {
  const [query, setQueryState] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const [currentMatch, setCurrentMatch] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const activeQuery = useRef("");

  const runHighlight = useCallback(
    (q: string) => {
      const container = containerRef.current;
      if (!container) return;
      activeQuery.current = q;
      const count = highlightMatches(container, q);
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
