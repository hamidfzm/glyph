import { renderHook } from "@testing-library/react";
import type { RefObject } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSyncedScroll } from "./useSyncedScroll";

const VIEWPORT = 500;

// jsdom reports every element as 0x0, so the scrollable range each pane should
// map through has to be declared explicitly.
function sizeScroller(el: HTMLElement, range: number) {
  Object.defineProperty(el, "clientHeight", { value: VIEWPORT, configurable: true });
  Object.defineProperty(el, "scrollHeight", { value: VIEWPORT + range, configurable: true });
}

function buildSplit(editorRange: number, previewRange: number) {
  const root = document.createElement("div");
  const editor = document.createElement("div");
  editor.className = "cm-scroller";
  const preview = document.createElement("div");
  preview.setAttribute("data-scroll-container", "");
  const content = document.createElement("div");
  content.className = "markdown-body";
  preview.append(content);
  root.append(editor, preview);
  document.body.append(root);
  sizeScroller(editor, editorRange);
  sizeScroller(preview, previewRange);
  const rootRef: RefObject<HTMLElement | null> = { current: root };
  return { rootRef, editor, preview };
}

function scroll(el: HTMLElement, top: number) {
  el.scrollTop = top;
  el.dispatchEvent(new Event("scroll"));
}

/** Replaces ResizeObserver with one whose callback the test fires by hand. */
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

  // A keymap change tears down the editor instance and builds a new one, so a
  // scroll can land while one of the two scrollers is briefly missing.
  it("ignores scroll while a pane is missing", () => {
    const { rootRef, editor, preview } = buildSplit(1000, 400);
    renderHook(() => useSyncedScroll(rootRef, true));

    preview.remove();
    scroll(editor, 500);

    expect(preview.scrollTop).toBe(0);
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
