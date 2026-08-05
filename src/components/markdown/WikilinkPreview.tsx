import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useEmbedContext } from "@/contexts/EmbedContext";
import { useCreateWikilinkNote } from "@/hooks/useCreateWikilinkNote";
import { readNoteCached } from "@/lib/noteContentCache";
import { type PreviewLoadState, WikilinkPreviewBody } from "./WikilinkPreviewBody";

const WIDTH = 440;
const MAX_HEIGHT = 400;
const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 6;

// `wikilink-preview` (markdown.css) adds the materialize-in transition and its
// transform-origin follows the flip via the inline style below.
const SURFACE_CLASS =
  "wikilink-preview fixed z-50 overflow-y-auto overscroll-contain rounded-[var(--glyph-radius)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 shadow-[0_10px_30px_rgba(0,0,0,0.22)] text-[var(--color-text-primary)]";

interface WikilinkPreviewProps {
  /** The hovered anchor; the popover positions itself against its rect. */
  anchor: HTMLElement;
  target: string;
  path?: string;
  heading?: string;
  onOpen: () => void;
  /** Pointer re-entered the popover: cancel the pending close. */
  onKeepOpen: () => void;
  onClose: () => void;
}

// Floating preview of a wikilink's target, shown after a hover delay. Renders
// through the shared MarkdownContent so it matches the document view. A
// `#heading` link previews just that section (the same slice embeds use)
// rather than scrolling a full render.
export function WikilinkPreview({
  anchor,
  target,
  path,
  heading,
  onOpen,
  onKeepOpen,
  onClose,
}: WikilinkPreviewProps) {
  const { workspaceFiles } = useEmbedContext();
  const createNote = useCreateWikilinkNote();
  const rootRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  // Scale-in origin: from the top when the popover sits below the anchor, from
  // the bottom when it flips above, so it grows out of the link either way.
  const [origin, setOrigin] = useState("top left");
  const [state, setState] = useState<PreviewLoadState>({ status: "loading" });

  // Only ever read a file the resolver already matched to a workspace member.
  // `data-wikilink-path` can be injected via raw HTML that survives the
  // sanitizer, so this gate (mirroring EmbedComponent's) keeps `read_file` off
  // arbitrary absolute paths.
  const canLoad = !!path && !!workspaceFiles?.includes(path);

  useEffect(() => {
    if (!canLoad || !path) return;
    let alive = true;
    readNoteCached(path)
      .then((content) => {
        if (alive) setState({ status: "ready", content });
      })
      .catch(() => {
        if (alive) setState({ status: "error" });
      });
    return () => {
      alive = false;
    };
  }, [canLoad, path]);

  // Position before paint, and again once content lands and the height changes.
  // Prefers below the anchor, flips above when that side has more room, then
  // clamps both axes into the viewport.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `state` is a re-measure trigger, not a value read; the height changes when content replaces the loading line
  useLayoutEffect(() => {
    // Attached before any layout effect runs, so it is never null here.
    const el = rootRef.current!;
    const rect = anchor.getBoundingClientRect();
    const height = el.offsetHeight;
    const spaceBelow = window.innerHeight - rect.bottom - ANCHOR_GAP - VIEWPORT_MARGIN;
    const spaceAbove = rect.top - ANCHOR_GAP - VIEWPORT_MARGIN;
    const flipUp = height > spaceBelow && spaceAbove > spaceBelow;
    const rawTop = flipUp ? rect.top - ANCHOR_GAP - height : rect.bottom + ANCHOR_GAP;
    const maxTop = window.innerHeight - height - VIEWPORT_MARGIN;
    const maxLeft = window.innerWidth - WIDTH - VIEWPORT_MARGIN;
    setPos({
      top: Math.max(VIEWPORT_MARGIN, Math.min(rawTop, maxTop)),
      left: Math.max(VIEWPORT_MARGIN, Math.min(rect.left, maxLeft)),
    });
    setOrigin(flipUp ? "bottom left" : "top left");
  }, [anchor, state]);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onClose();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", handleMouseDown, true);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", handleMouseDown, true);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  // Clicking the surface opens the note in full (the issue's "click anywhere to
  // navigate"); Enter mirrors it for anyone who reaches the popover by keyboard.
  const handleOpen = canLoad ? onOpen : undefined;

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={target}
      className={SURFACE_CLASS}
      style={{
        top: pos.top,
        left: pos.left,
        width: WIDTH,
        maxHeight: MAX_HEIGHT,
        transformOrigin: origin,
      }}
      onMouseEnter={onKeepOpen}
      onMouseLeave={onClose}
      onClick={handleOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter") handleOpen?.();
      }}
    >
      <WikilinkPreviewBody
        state={state}
        path={canLoad ? path : undefined}
        target={target}
        heading={heading}
        workspaceFiles={workspaceFiles}
        createNote={createNote}
      />
    </div>
  );
}
