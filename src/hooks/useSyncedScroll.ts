import { type RefObject, useEffect } from "react";

// Resolved at event time, not held as refs: CodeMirror owns `.cm-scroller` and
// builds a fresh one whenever the keymap preset rebuilds the editor.
const EDITOR_SCROLLER = ".cm-scroller";
const PREVIEW_SCROLLER = "[data-scroll-container]";
const PREVIEW_CONTENT = ".markdown-body";

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
    let leader: HTMLElement | null = null;

    const findPanes = () => ({
      editor: root.querySelector<HTMLElement>(EDITOR_SCROLLER),
      preview: root.querySelector<HTMLElement>(PREVIEW_SCROLLER),
    });

    const follow = (from: HTMLElement, to: HTMLElement) => {
      const fromRange = scrollRange(from);
      const toRange = scrollRange(to);
      if (fromRange <= 0 || toRange <= 0) return;
      const top = (from.scrollTop / fromRange) * toRange;
      written.set(to, top);
      to.scrollTop = top;
    };

    // `scroll` does not bubble but does capture-propagate, so one listener on the
    // split root covers both panes however deep their scrollers sit.
    const handleScroll = (event: Event) => {
      const { editor, preview } = findPanes();
      if (!editor || !preview) return;

      let source: HTMLElement | null = null;
      if (event.target === editor) source = editor;
      if (event.target === preview) source = preview;
      if (!source) return;

      const expected = written.get(source);
      written.delete(source);
      if (expected !== undefined && Math.abs(source.scrollTop - expected) < 1) return;

      const follower = source === editor ? preview : editor;
      leader = source;
      follow(source, follower);
    };

    // Images, diagrams, and math lay out after the initial render and change the
    // preview's height, which would otherwise leave the panes at a stale offset.
    const observer = new ResizeObserver(() => {
      if (!leader) return;
      const { editor, preview } = findPanes();
      if (!editor || !preview) return;
      const follower = leader === editor ? preview : editor;
      follow(leader, follower);
    });
    const content = root.querySelector<HTMLElement>(PREVIEW_CONTENT);
    if (content) observer.observe(content);

    root.addEventListener("scroll", handleScroll, { capture: true, passive: true });
    return () => {
      root.removeEventListener("scroll", handleScroll, { capture: true });
      observer.disconnect();
    };
  }, [rootRef, enabled]);
}
