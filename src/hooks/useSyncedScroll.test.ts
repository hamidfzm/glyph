import type { EditorView } from "@codemirror/view";
import { renderHook } from "@testing-library/react";
import type { RefObject } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureResizeObserver, sizeScroller, stubOffsetTop } from "@/test/scrollMetrics";
import { useSyncedScroll } from "./useSyncedScroll";

const LINE_HEIGHT = 20;
const LINE_LENGTH = 10;
const LINES = 100;

/** Enough of the EditorView surface for the hook, backed by uniform lines. */
function fakeView(scrollDOM: HTMLElement) {
  const blockFor = (line: number) => ({
    from: (line - 1) * LINE_LENGTH,
    top: (line - 1) * LINE_HEIGHT,
    height: LINE_HEIGHT,
  });
  const clampLine = (line: number) => Math.min(Math.max(line, 1), LINES);
  return {
    scrollDOM,
    // The scroller sits at screen 0, so the document top tracks the scroll offset.
    get documentTop() {
      return -scrollDOM.scrollTop;
    },
    elementAtHeight: (h: number) => blockFor(clampLine(Math.floor(h / LINE_HEIGHT) + 1)),
    lineBlockAt: (pos: number) => blockFor(clampLine(Math.floor(pos / LINE_LENGTH) + 1)),
    state: {
      doc: {
        lines: LINES,
        lineAt: (pos: number) => ({ number: clampLine(Math.floor(pos / LINE_LENGTH) + 1) }),
        line: (line: number) => ({ from: (clampLine(line) - 1) * LINE_LENGTH }),
      },
    },
  } as unknown as EditorView;
}

/** Anchors at line 1 -> 0px and line 11 -> 500px, so one line is 50 preview px. */
const ANCHOR_LINES = [1, 11];

function buildSplit({ anchors = ANCHOR_LINES, previewRange = 1000 } = {}) {
  const root = document.createElement("div");
  root.className = "split-view";
  const editorPane = document.createElement("div");
  editorPane.className = "split-view-editor";
  const previewPane = document.createElement("div");
  previewPane.className = "split-view-preview";
  root.append(editorPane, previewPane);
  document.body.append(root);

  const editor = document.createElement("div");
  editor.className = "cm-scroller";
  editorPane.append(editor);
  Object.defineProperty(editor, "getBoundingClientRect", { value: () => ({ top: 0 }) });
  sizeScroller(editor, LINES * LINE_HEIGHT);

  const preview = document.createElement("div");
  preview.setAttribute("data-scroll-container", "");
  const content = document.createElement("div");
  content.className = "markdown-body";
  preview.append(content);
  previewPane.append(preview);
  sizeScroller(preview, previewRange);

  for (const [index, line] of anchors.entries()) {
    const block = document.createElement("p");
    block.dataset.line = String(line);
    stubOffsetTop(block, index * 500);
    content.append(block);
  }

  const rootRef: RefObject<HTMLElement | null> = { current: root };
  return { rootRef, editor, preview, content, view: fakeView(editor) };
}

function scroll(el: HTMLElement, top: number) {
  el.scrollTop = top;
  el.dispatchEvent(new Event("scroll"));
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("useSyncedScroll", () => {
  it("scrolls the preview to the block the editor's top line belongs to", () => {
    const { rootRef, editor, preview, view } = buildSplit();
    renderHook(() => useSyncedScroll(rootRef, view, true));

    // Line 6 of 1..11, halfway between the two anchors.
    scroll(editor, 5 * LINE_HEIGHT);

    expect(preview.scrollTop).toBe(250);
  });

  it("carries a partly scrolled line through as a fraction", () => {
    const { rootRef, editor, preview, view } = buildSplit();
    renderHook(() => useSyncedScroll(rootRef, view, true));

    scroll(editor, 5 * LINE_HEIGHT + LINE_HEIGHT / 2);

    expect(preview.scrollTop).toBe(275);
  });

  it("scrolls the editor to the line the preview is showing", () => {
    const { rootRef, editor, preview, view } = buildSplit();
    renderHook(() => useSyncedScroll(rootRef, view, true));

    scroll(preview, 250);

    expect(editor.scrollTop).toBe(5 * LINE_HEIGHT);
  });

  it("falls back to matching scroll ratios when the preview has no anchors", () => {
    const { rootRef, editor, preview, view } = buildSplit({ anchors: [] });
    renderHook(() => useSyncedScroll(rootRef, view, true));

    // Half of the editor's 2000px range maps to half of the preview's 1000px.
    scroll(editor, 1000);

    expect(preview.scrollTop).toBe(500);
  });

  it("drops the follower's echoed scroll event instead of moving the leader back", () => {
    const { rootRef, editor, preview, view } = buildSplit();
    renderHook(() => useSyncedScroll(rootRef, view, true));

    scroll(editor, 5 * LINE_HEIGHT);
    expect(preview.scrollTop).toBe(250);

    editor.scrollTop = 0;
    preview.dispatchEvent(new Event("scroll"));

    expect(editor.scrollTop).toBe(0);
  });

  it("still follows a real scroll on the pane that was last written to", () => {
    const { rootRef, editor, preview, view } = buildSplit();
    renderHook(() => useSyncedScroll(rootRef, view, true));

    scroll(editor, 5 * LINE_HEIGHT);
    scroll(preview, 500);

    expect(editor.scrollTop).toBe(10 * LINE_HEIGHT);
  });

  it("attaches nothing when disabled", () => {
    const { rootRef, editor, preview, view } = buildSplit();
    renderHook(() => useSyncedScroll(rootRef, view, false));

    scroll(editor, 100);

    expect(preview.scrollTop).toBe(0);
  });

  it("attaches nothing before the editor view exists", () => {
    const { rootRef, editor, preview } = buildSplit();
    renderHook(() => useSyncedScroll(rootRef, null, true));

    scroll(editor, 100);

    expect(preview.scrollTop).toBe(0);
  });

  it("starts and stops syncing as the setting is toggled", () => {
    const { rootRef, editor, preview, view } = buildSplit();
    const { rerender } = renderHook(({ on }) => useSyncedScroll(rootRef, view, on), {
      initialProps: { on: false },
    });

    rerender({ on: true });
    scroll(editor, 5 * LINE_HEIGHT);
    expect(preview.scrollTop).toBe(250);

    rerender({ on: false });
    scroll(editor, 0);
    expect(preview.scrollTop).toBe(250);
  });

  it("ignores scroll events from elements that are neither pane", () => {
    const { rootRef, preview, view } = buildSplit();
    renderHook(() => useSyncedScroll(rootRef, view, true));

    const stray = document.createElement("div");
    rootRef.current?.append(stray);
    scroll(stray, 300);

    expect(preview.scrollTop).toBe(0);
  });

  it("ignores scroll while the preview pane is missing", () => {
    const { rootRef, editor, preview, view } = buildSplit();
    renderHook(() => useSyncedScroll(rootRef, view, true));

    preview.remove();
    scroll(editor, 100);

    expect(preview.scrollTop).toBe(0);
  });

  it("re-measures the anchors when the preview reflows", () => {
    const fireResize = captureResizeObserver();
    const { rootRef, editor, preview, content, view } = buildSplit();
    renderHook(() => useSyncedScroll(rootRef, view, true));

    scroll(editor, 5 * LINE_HEIGHT);
    expect(preview.scrollTop).toBe(250);

    // An image above line 11 finishes loading and pushes its anchor down.
    const [, second] = [...content.querySelectorAll<HTMLElement>("[data-line]")];
    stubOffsetTop(second, 900);
    fireResize();

    expect(preview.scrollTop).toBe(450);
  });

  it("re-applies from the preview when the preview is the leader", () => {
    const fireResize = captureResizeObserver();
    const { rootRef, editor, preview, content, view } = buildSplit();
    renderHook(() => useSyncedScroll(rootRef, view, true));

    scroll(preview, 250);
    expect(editor.scrollTop).toBe(5 * LINE_HEIGHT);

    const [, second] = [...content.querySelectorAll<HTMLElement>("[data-line]")];
    stubOffsetTop(second, 1000);
    fireResize();

    expect(editor.scrollTop).toBe(Math.round(2.5 * LINE_HEIGHT));
  });

  it("does not re-apply on reflow before either pane has been scrolled", () => {
    const fireResize = captureResizeObserver();
    const { rootRef, preview, view } = buildSplit();
    renderHook(() => useSyncedScroll(rootRef, view, true));

    fireResize();

    expect(preview.scrollTop).toBe(0);
  });

  it("stops syncing once unmounted", () => {
    const { rootRef, editor, preview, view } = buildSplit();
    const { unmount } = renderHook(() => useSyncedScroll(rootRef, view, true));

    unmount();
    scroll(editor, 100);

    expect(preview.scrollTop).toBe(0);
  });
});
