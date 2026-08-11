import { renderHook } from "@testing-library/react";
import type { RefObject } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sizeScroller } from "@/test/scrollMetrics";
import { useSyncedScroll } from "./useSyncedScroll";

function addScroller(parent: HTMLElement, className: string, contentClass: string, range: number) {
  const scroller = document.createElement("div");
  scroller.className = className;
  const content = document.createElement("div");
  content.className = contentClass;
  scroller.append(content);
  parent.append(scroller);
  sizeScroller(scroller, range);
  return scroller;
}

function buildSplit(editorRange: number, previewRange: number) {
  const root = document.createElement("div");
  root.className = "split-view";
  const editorPane = document.createElement("div");
  editorPane.className = "split-view-editor";
  const previewPane = document.createElement("div");
  previewPane.className = "split-view-preview";
  root.append(editorPane, previewPane);
  document.body.append(root);

  const editor = addScroller(editorPane, "cm-scroller", "cm-content", editorRange);
  const preview = addScroller(previewPane, "preview-scroller", "markdown-body", previewRange);
  preview.setAttribute("data-scroll-container", "");

  const rootRef: RefObject<HTMLElement | null> = { current: root };
  return { rootRef, editorPane, editor, preview };
}

function scroll(el: HTMLElement, top: number) {
  el.scrollTop = top;
  el.dispatchEvent(new Event("scroll"));
}

/** Replaces ResizeObserver with one whose callbacks the test fires by hand. */
function captureResizeObserver() {
  const observers: (() => void)[] = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        observers.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  return () => {
    for (const callback of observers) callback();
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("useSyncedScroll", () => {
  it("maps the editor's scroll ratio onto the preview's own range", () => {
    const { rootRef, editor, preview } = buildSplit(1000, 400);
    renderHook(() => useSyncedScroll(rootRef, true));

    scroll(editor, 500);

    expect(preview.scrollTop).toBe(200);
  });

  it("syncs in the other direction too", () => {
    const { rootRef, editor, preview } = buildSplit(1000, 400);
    renderHook(() => useSyncedScroll(rootRef, true));

    scroll(preview, 100);

    expect(editor.scrollTop).toBe(250);
  });

  it("drops the follower's echoed scroll event instead of moving the leader back", () => {
    const { rootRef, editor, preview } = buildSplit(1000, 400);
    renderHook(() => useSyncedScroll(rootRef, true));

    scroll(editor, 500);
    expect(preview.scrollTop).toBe(200);

    // The browser dispatches a scroll event for the offset the hook just wrote.
    // Park the editor somewhere the echo would visibly overwrite.
    editor.scrollTop = 0;
    preview.dispatchEvent(new Event("scroll"));

    expect(editor.scrollTop).toBe(0);
  });

  // Real browsers store an integer scrollTop, so an echo rarely reports back the
  // fractional offset that was written to it.
  it("treats an echo rounded to a whole pixel as an echo", () => {
    const { rootRef, editor, preview } = buildSplit(1000, 333);
    renderHook(() => useSyncedScroll(rootRef, true));

    scroll(editor, 500);
    expect(preview.scrollTop).toBeCloseTo(166.5);

    editor.scrollTop = 0;
    scroll(preview, 167);

    expect(editor.scrollTop).toBe(0);
  });

  it("treats a move of more than a pixel as a real scroll", () => {
    const { rootRef, editor, preview } = buildSplit(1000, 333);
    renderHook(() => useSyncedScroll(rootRef, true));

    scroll(editor, 500);
    editor.scrollTop = 0;
    scroll(preview, 169);

    expect(editor.scrollTop).toBeCloseTo((169 / 333) * 1000);
  });

  it("still follows a real scroll on the pane that was last written to", () => {
    const { rootRef, editor, preview } = buildSplit(1000, 400);
    renderHook(() => useSyncedScroll(rootRef, true));

    scroll(editor, 500);
    scroll(preview, 400);

    expect(editor.scrollTop).toBe(1000);
  });

  it("attaches nothing when disabled", () => {
    const { rootRef, editor, preview } = buildSplit(1000, 400);
    renderHook(() => useSyncedScroll(rootRef, false));

    scroll(editor, 500);

    expect(preview.scrollTop).toBe(0);
  });

  it("starts and stops syncing as the setting is toggled", () => {
    const { rootRef, editor, preview } = buildSplit(1000, 400);
    const { rerender } = renderHook(({ on }) => useSyncedScroll(rootRef, on), {
      initialProps: { on: false },
    });

    rerender({ on: true });
    scroll(editor, 500);
    expect(preview.scrollTop).toBe(200);

    rerender({ on: false });
    scroll(editor, 1000);
    expect(preview.scrollTop).toBe(200);
  });

  it("leaves a pane with no scrollable range alone", () => {
    const { rootRef, editor, preview } = buildSplit(1000, 0);
    renderHook(() => useSyncedScroll(rootRef, true));

    scroll(editor, 500);

    expect(preview.scrollTop).toBe(0);
  });

  it("ignores scroll events from elements that are neither pane", () => {
    const { rootRef, preview } = buildSplit(1000, 400);
    renderHook(() => useSyncedScroll(rootRef, true));

    const stray = document.createElement("div");
    rootRef.current?.append(stray);
    scroll(stray, 300);

    expect(preview.scrollTop).toBe(0);
  });

  // A keymap change destroys the editor view and builds a new one, so the pane
  // is briefly absent and then a different element entirely.
  it("ignores scroll while a pane is missing", () => {
    const { rootRef, editor, preview } = buildSplit(1000, 400);
    renderHook(() => useSyncedScroll(rootRef, true));

    preview.remove();
    scroll(editor, 500);

    expect(preview.scrollTop).toBe(0);
  });

  it("follows the editor's replacement scroller", () => {
    const { rootRef, editorPane, editor, preview } = buildSplit(1000, 400);
    renderHook(() => useSyncedScroll(rootRef, true));

    editor.remove();
    const rebuilt = addScroller(editorPane, "cm-scroller", "cm-content", 2000);
    scroll(rebuilt, 1000);

    expect(preview.scrollTop).toBe(200);
  });

  it("re-applies the last sync when the preview reflows", () => {
    const fireResize = captureResizeObserver();
    const { rootRef, editor, preview } = buildSplit(1000, 400);
    renderHook(() => useSyncedScroll(rootRef, true));

    scroll(editor, 500);
    expect(preview.scrollTop).toBe(200);

    // An image finishes loading and the preview grows.
    sizeScroller(preview, 800);
    fireResize();

    expect(preview.scrollTop).toBe(400);
  });

  it("re-applies from the preview when the preview is the leader", () => {
    const fireResize = captureResizeObserver();
    const { rootRef, editor, preview } = buildSplit(1000, 400);
    renderHook(() => useSyncedScroll(rootRef, true));

    scroll(preview, 200);
    expect(editor.scrollTop).toBe(500);

    sizeScroller(editor, 2000);
    fireResize();

    expect(editor.scrollTop).toBe(1000);
  });

  it("skips the reflow re-sync while a pane is missing", () => {
    const fireResize = captureResizeObserver();
    const { rootRef, editor, preview } = buildSplit(1000, 400);
    renderHook(() => useSyncedScroll(rootRef, true));

    scroll(editor, 500);
    preview.remove();
    fireResize();

    expect(preview.scrollTop).toBe(200);
  });

  it("does not re-apply on reflow before either pane has been scrolled", () => {
    const fireResize = captureResizeObserver();
    const { rootRef, preview } = buildSplit(1000, 400);
    renderHook(() => useSyncedScroll(rootRef, true));

    fireResize();

    expect(preview.scrollTop).toBe(0);
  });

  it("stops syncing once unmounted", () => {
    const { rootRef, editor, preview } = buildSplit(1000, 400);
    const { unmount } = renderHook(() => useSyncedScroll(rootRef, true));

    unmount();
    scroll(editor, 500);

    expect(preview.scrollTop).toBe(0);
  });
});
