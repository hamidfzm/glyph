import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContextMenuActions } from "@/lib/contextMenuItems";
import { AI_REPLY_HTML } from "@/test/fixtures/aiReply";
import { CANVAS_CARDS_HTML } from "@/test/fixtures/canvasCards";
import { mountDocumentBody } from "@/test/mountDocumentBody";
import { useContextMenu } from "./useContextMenu";

function fireContextMenu(target: EventTarget, init?: MouseEventInit) {
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

function mountMarkdown() {
  return mountDocumentBody("<p>doc body</p>").firstElementChild as Element;
}

const baseActions: ContextMenuActions = {};

afterEach(() => {
  vi.restoreAllMocks();
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = "";
});

function actionLabels(menu: { items: { kind: string; label?: string }[] } | null) {
  return menu?.items.flatMap((i) => (i.kind === "action" && i.label ? [i.label] : [])) ?? [];
}

describe("useContextMenu", () => {
  it("opens a themed menu inside the markdown body and suppresses the native one", () => {
    const para = mountMarkdown();
    const { result } = renderHook(() => useContextMenu(baseActions));

    expect(result.current.menu).toBeNull();

    let event: MouseEvent;
    act(() => {
      event = fireContextMenu(para, { clientX: 12, clientY: 34 });
    });

    expect(event!.defaultPrevented).toBe(true);
    expect(result.current.menu).toMatchObject({ x: 12, y: 34 });
    expect(actionLabels(result.current.menu)).toContain("Select All");
  });

  it("shows no themed menu over assistant replies in the AI chat panel", () => {
    // Chat replies render with .markdown-body too, but the document-targeted
    // menu is wrong there; the panel has its own per-message actions.
    document.body.innerHTML = AI_REPLY_HTML;
    const para = document.querySelector(".ai-chat-panel p") as Element;
    const { result } = renderHook(() => useContextMenu(baseActions));

    let event: MouseEvent;
    act(() => {
      event = fireContextMenu(para);
    });

    expect(event!.defaultPrevented).toBe(true);
    expect(result.current.menu).toBeNull();
  });

  it("suppresses the native menu outside the markdown body without showing a themed menu", () => {
    const chrome = document.createElement("div");
    chrome.textContent = "Sidebar label";
    document.body.appendChild(chrome);
    const { result } = renderHook(() => useContextMenu(baseActions));

    let event: MouseEvent;
    act(() => {
      event = fireContextMenu(chrome);
    });

    expect(event!.defaultPrevented).toBe(true);
    expect(result.current.menu).toBeNull();
  });

  it("suppresses the native menu and shows nothing for non-element targets", () => {
    const { result } = renderHook(() => useContextMenu(baseActions));

    let event: MouseEvent;
    act(() => {
      event = fireContextMenu(document);
    });

    expect(event!.defaultPrevented).toBe(true);
    expect(result.current.menu).toBeNull();
  });

  it("keeps the native menu inside editable fields", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    const { result } = renderHook(() => useContextMenu(baseActions));

    let event: MouseEvent;
    act(() => {
      event = fireContextMenu(input);
    });

    expect(event!.defaultPrevented).toBe(false);
    expect(result.current.menu).toBeNull();
  });

  it("defers to a more specific handler that already called preventDefault", () => {
    const para = mountMarkdown();
    const claim = (e: MouseEvent) => e.preventDefault();
    document.addEventListener("contextmenu", claim, { capture: true });
    const { result } = renderHook(() => useContextMenu(baseActions));

    act(() => {
      fireContextMenu(para);
    });

    expect(result.current.menu).toBeNull();
    document.removeEventListener("contextmenu", claim, { capture: true });
  });

  it("opens with default items when there is no selection object", () => {
    const para = mountMarkdown();
    vi.spyOn(window, "getSelection").mockReturnValue(null);
    const { result } = renderHook(() => useContextMenu(baseActions));

    act(() => {
      fireContextMenu(para);
    });

    expect(actionLabels(result.current.menu)).toContain("Select All");
  });

  it("adds link actions when the target is inside an external link", () => {
    const body = document.createElement("div");
    body.className = "markdown-body";
    const anchor = document.createElement("a");
    anchor.setAttribute("href", "https://example.com");
    const strong = document.createElement("strong");
    strong.textContent = "example";
    anchor.appendChild(strong);
    body.appendChild(anchor);
    document.body.appendChild(body);
    const { result } = renderHook(() => useContextMenu(baseActions));

    act(() => {
      fireContextMenu(strong);
    });

    const labels = actionLabels(result.current.menu);
    expect(labels).toContain("Copy Link Address");
    expect(labels).toContain("Open in External Browser");
  });

  it("shows no link actions for internal links (wikilinks render as href='#')", () => {
    const body = document.createElement("div");
    body.className = "markdown-body";
    const anchor = document.createElement("a");
    anchor.setAttribute("href", "#");
    anchor.textContent = "wikilink";
    body.appendChild(anchor);
    document.body.appendChild(body);
    const { result } = renderHook(() => useContextMenu(baseActions));

    act(() => {
      fireContextMenu(anchor);
    });

    expect(actionLabels(result.current.menu)).toEqual(["Select All"]);
  });

  it("Select All selects only the canvas card that was right-clicked", () => {
    document.body.innerHTML = CANVAS_CARDS_HTML;
    const { result } = renderHook(() => useContextMenu(baseActions));

    act(() => {
      fireContextMenu(document.querySelectorAll(".markdown-body p")[2]);
    });

    const selectAll = result.current.menu?.items.find(
      (i) => i.kind === "action" && i.label === "Select All",
    );
    if (selectAll?.kind === "action") selectAll.onSelect();
    expect(window.getSelection()?.toString()).toBe("third");
  });

  it("close() clears the open menu", () => {
    const para = mountMarkdown();
    const { result } = renderHook(() => useContextMenu(baseActions));
    act(() => {
      fireContextMenu(para);
    });
    expect(result.current.menu).not.toBeNull();

    act(() => {
      result.current.close();
    });
    expect(result.current.menu).toBeNull();
  });

  it("removes its listener on unmount", () => {
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const { unmount } = renderHook(() => useContextMenu(baseActions));

    act(() => {
      unmount();
    });

    expect(removeSpy).toHaveBeenCalledWith("contextmenu", expect.any(Function));
  });
});
