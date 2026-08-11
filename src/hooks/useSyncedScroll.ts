import type { EditorView } from "@codemirror/view";
import { type RefObject, useEffect } from "react";
import { offsetForEditorLine, topVisibleLine } from "@/lib/editorLineOffsets";
import { lineForOffset, offsetForLine, type ScrollAnchor } from "@/lib/splitScrollAnchors";

// Scoped to the pane wrappers: `.markdown-body` is a class name a rendered
// document could otherwise contribute from inside the preview.
const PREVIEW_SCROLLER = ".split-view-preview [data-scroll-container]";
const PREVIEW_CONTENT = ".split-view-preview .markdown-body";
const ANCHORS = "[data-line]";

export function useSyncedScroll(
  rootRef: RefObject<HTMLElement | null>,
  view: EditorView | null,
  enabled: boolean,
) {
  useEffect(() => {
    const root = rootRef.current;
    if (!enabled || !root || !view) return;
    const editor = view.scrollDOM;

    // Offset last written to a pane, so that pane's own scroll event can be told
    // apart from a user scroll. A frame or timer lock would race: the callback
    // can run before the browser dispatches the event it was meant to cover.
    const written = new WeakMap<HTMLElement, number>();
    let leader: "editor" | "preview" | null = null;

    // Measuring every anchor costs a layout pass, so the list is built once and
    // rebuilt only when the preview reflows, not on each scroll event.
    let anchors: ScrollAnchor[] = [];
    const measureAnchors = (preview: HTMLElement) => {
      anchors = [...preview.querySelectorAll<HTMLElement>(ANCHORS)].map((el) => ({
        line: Number(el.dataset.line),
        top: el.offsetTop,
      }));
    };

    const scrollTo = (pane: HTMLElement, top: number) => {
      pane.scrollTop = top;
      // Read back rather than recording the requested offset: the browser rounds
      // and clamps, and an elastic overscroll bounce lands well away from it.
      written.set(pane, pane.scrollTop);
    };

    // Falls back to matching each pane's scrolled fraction, which is all that is
    // available before the preview has rendered any anchors.
    const followByRatio = (from: HTMLElement, to: HTMLElement) => {
      const fromRange = from.scrollHeight - from.clientHeight;
      const toRange = to.scrollHeight - to.clientHeight;
      if (fromRange <= 0 || toRange <= 0) return;
      scrollTo(to, (from.scrollTop / fromRange) * toRange);
    };

    const editorToPreview = (preview: HTMLElement) => {
      const top = offsetForLine(anchors, topVisibleLine(view));
      if (top === null) followByRatio(editor, preview);
      else scrollTo(preview, top);
    };

    const previewToEditor = (preview: HTMLElement) => {
      const line = lineForOffset(anchors, preview.scrollTop);
      if (line === null) followByRatio(preview, editor);
      else scrollTo(editor, offsetForEditorLine(view, line));
    };

    const syncFrom = (name: "editor" | "preview", pane: HTMLElement, preview: HTMLElement) => {
      const expected = written.get(pane);
      written.delete(pane);
      if (expected !== undefined && Math.abs(pane.scrollTop - expected) < 1) return;
      leader = name;
      if (name === "editor") editorToPreview(preview);
      else previewToEditor(preview);
    };

    // `scroll` does not bubble but does capture-propagate, so one listener on the
    // split root covers both panes however deep their scrollers sit.
    const handleScroll = (event: Event) => {
      const preview = root.querySelector<HTMLElement>(PREVIEW_SCROLLER);
      if (!preview) return;
      if (event.target === editor) syncFrom("editor", editor, preview);
      if (event.target === preview) syncFrom("preview", preview, preview);
    };

    // The preview re-renders on a debounce and grows as images, diagrams, and
    // math lay out, which moves every anchor below them.
    const observer = new ResizeObserver(() => {
      const preview = root.querySelector<HTMLElement>(PREVIEW_SCROLLER);
      if (!preview) return;
      measureAnchors(preview);
      if (leader === "editor") editorToPreview(preview);
      else if (leader === "preview") previewToEditor(preview);
    });
    const content = root.querySelector<HTMLElement>(PREVIEW_CONTENT);
    if (content) {
      measureAnchors(content.closest<HTMLElement>(PREVIEW_SCROLLER) ?? content);
      observer.observe(content);
    }

    root.addEventListener("scroll", handleScroll, { capture: true, passive: true });
    return () => {
      root.removeEventListener("scroll", handleScroll, { capture: true });
      observer.disconnect();
    };
  }, [rootRef, view, enabled]);
}
