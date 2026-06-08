import { useEffect, useRef, useState } from "react";
import { onActiveHeadingChange } from "@/lib/scrollToHeading";
import type { TocEntry } from "./useTableOfContents";

// How long to ignore observer updates after a programmatic scroll. Smooth
// scrolls in modern browsers complete in ~300-500ms; during that window the
// observer fires many times as intermediate headings cross the observation
// band, and would override the heading the user actually clicked on.
const SCROLL_LOCK_MS = 700;

// Tracks which table-of-contents heading is currently active, driven by scroll
// position (IntersectionObserver) and by programmatic scrolls.
export function useActiveHeading(entries: TocEntry[]) {
  const [activeId, setActiveId] = useState<string>("");
  const observerRef = useRef<IntersectionObserver | null>(null);
  const lockUntilRef = useRef(0);

  useEffect(() => {
    observerRef.current?.disconnect();
    if (entries.length === 0) return;

    observerRef.current = new IntersectionObserver(
      (intersections) => {
        if (performance.now() < lockUntilRef.current) return;
        for (const entry of intersections) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
            break;
          }
        }
      },
      { rootMargin: "-20px 0px -60% 0px", threshold: 0.1 },
    );

    for (const entry of entries) {
      const el = document.getElementById(entry.id);
      if (el) observerRef.current.observe(el);
    }

    return () => observerRef.current?.disconnect();
  }, [entries]);

  // Sync immediately on programmatic scrolls and lock the observer so it
  // doesn't override us while the smooth scroll is still in flight.
  useEffect(
    () =>
      onActiveHeadingChange((id) => {
        lockUntilRef.current = performance.now() + SCROLL_LOCK_MS;
        setActiveId(id);
      }),
    [],
  );

  return activeId;
}
