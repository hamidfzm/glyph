import { type RefObject, useLayoutEffect, useRef } from "react";
import type { LightboxTableItem, NaturalSize } from "@/lib/lightbox";

interface LightboxTableProps {
  table: LightboxTableItem;
  scale: number;
  /** The table's own scroll box, which the fit measures and the keys scroll. */
  scrollerRef: RefObject<HTMLDivElement | null>;
  onMeasure: (size: NaturalSize) => void;
}

// A document table in the lightbox. It renders the table's own React children,
// not a copy of its HTML, so links and wikilinks keep their handlers, inside a
// `.markdown-body` for the document's table styling. CSS `zoom` reflows it, and
// it scrolls in a box of its own so the sticky header row has an edge to stick
// to, with nothing scrolling into view above it.
export function LightboxTable({ table, scale, scrollerRef, onMeasure }: LightboxTableProps) {
  const bodyRef = useRef<HTMLDivElement>(null);

  // Measured before the first paint, while the zoom is still 1.
  useLayoutEffect(() => {
    const body = bodyRef.current!;
    onMeasure({ w: body.offsetWidth, h: body.offsetHeight });
  }, [onMeasure]);

  return (
    // The direction sits on the scroller too, so an RTL table opens at its start.
    <div ref={scrollerRef} className="lightbox-table-scroller" dir={table.dir} tabIndex={-1}>
      <div ref={bodyRef} className="markdown-body lightbox-table" style={{ zoom: scale }}>
        <table>{table.content}</table>
      </div>
    </div>
  );
}
