import { type RefObject, useEffect } from "react";

// Scoped to the pane wrappers and resolved at event time: CodeMirror builds a
// fresh `.cm-scroller` whenever the keymap preset rebuilds the editor, and both
// `.cm-scroller` and `.markdown-body` are class names a rendered document could
// otherwise contribute from inside the preview.
const EDITOR_SCROLLER = ".split-view-editor .cm-scroller";
const EDITOR_CONTENT = ".split-view-editor .cm-content";
const PREVIEW_SCROLLER = ".split-view-preview [data-scroll-container]";
const PREVIEW_CONTENT = ".split-view-preview .markdown-body";

// CodeMirror reports an estimated scrollHeight for lines it has not measured,
// so the editor's range shifts a little as a long document is scrolled through.
function scrollRange(el: HTMLElement) {
  return el.scrollHeight - el.clientHeight;
}

/** Links the split view's panes so scrolling one moves the other to the matching ratio. */
export function useSyncedScroll(rootRef: RefObject<HTMLElement | null>, enabled: boolean) {
  useEffect(() => {
    const root = rootRef.current;
    if (!enabled || !root) return;

    // Offset last written to a pane, so that pane's own scroll event can be told
    // apart from a user scroll. A frame or timer lock would race: the callback
    // can run before the browser dispatches the event it was meant to cover.
    const written = new WeakMap<HTMLElement, number>();
    let leader: "editor" | "preview" | null = null;

    const findPanes = () => ({
      editor: root.querySelector<HTMLElement>(EDITOR_SCROLLER),
      preview: root.querySelector<HTMLElement>(PREVIEW_SCROLLER),
    });

    const follow = (from: HTMLElement, to: HTMLElement) => {
      const fromRange = scrollRange(from);
      const toRange = scrollRange(to);
      if (fromRange <= 0 || toRange <= 0) return;
      to.scrollTop = (from.scrollTop / fromRange) * toRange;
      // Read back rather than recording the requested offset: the browser rounds
      // and clamps, and an elastic overscroll bounce lands well away from it.
      written.set(to, to.scrollTop);
    };

    const syncFrom = (name: "editor" | "preview", from: HTMLElement, to: HTMLElement) => {
      const expected = written.get(from);
      written.delete(from);
      if (expected !== undefined && Math.abs(from.scrollTop - expected) < 1) return;
      leader = name;
      follow(from, to);
    };

    // `scroll` does not bubble but does capture-propagate, so one listener on the
    // split root covers both panes however deep their scrollers sit.
    const handleScroll = (event: Event) => {
      const { editor, preview } = findPanes();
      if (!editor || !preview) return;
      if (event.target === editor) syncFrom("editor", editor, preview);
      if (event.target === preview) syncFrom("preview", preview, editor);
    };

    // Images, diagrams, math, and typing change a pane's height after the fact,
    // which would otherwise leave the two sitting at a stale offset.
    const observer = new ResizeObserver(() => {
      if (!leader) return;
      const { editor, preview } = findPanes();
      if (!editor || !preview) return;
      if (leader === "editor") follow(editor, preview);
      else follow(preview, editor);
    });
    for (const selector of [EDITOR_CONTENT, PREVIEW_CONTENT]) {
      const content = root.querySelector<HTMLElement>(selector);
      if (content) observer.observe(content);
    }

    root.addEventListener("scroll", handleScroll, { capture: true, passive: true });
    return () => {
      root.removeEventListener("scroll", handleScroll, { capture: true });
      observer.disconnect();
    };
  }, [rootRef, enabled]);
}
