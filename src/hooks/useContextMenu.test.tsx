import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContextMenuActions } from "@/lib/contextMenuItems";
import { useContextMenu } from "./useContextMenu";

function fireContextMenu(target: EventTarget = document, init?: MouseEventInit) {
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

const baseActions: ContextMenuActions = { openFileDialog: vi.fn() };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useContextMenu", () => {
  it("opens a themed menu and suppresses the native one on a plain right-click", () => {
    const { result } = renderHook(() => useContextMenu(baseActions));

    expect(result.current.menu).toBeNull();

    let event: MouseEvent;
    act(() => {
      event = fireContextMenu(document, { clientX: 12, clientY: 34 });
    });

    expect(event!.defaultPrevented).toBe(true);
    expect(result.current.menu).toMatchObject({ x: 12, y: 34 });
    // Default (no selection) menu: Select All + Open File.
    const labels = result.current.menu?.items.flatMap((i) =>
      i.kind === "action" ? [i.label] : [],
    );
    expect(labels).toContain("Select All");
    expect(labels?.some((l) => l.startsWith("Open File"))).toBe(true);
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
    input.remove();
  });

  it("keeps the native menu inside a contenteditable surface", () => {
    const ce = document.createElement("div");
    ce.setAttribute("contenteditable", "true");
    document.body.appendChild(ce);
    const { result } = renderHook(() => useContextMenu(baseActions));

    let event: MouseEvent;
    act(() => {
      event = fireContextMenu(ce);
    });

    expect(event!.defaultPrevented).toBe(false);
    expect(result.current.menu).toBeNull();
    ce.remove();
  });

  it("defers to a more specific handler that already called preventDefault", () => {
    // Simulates the file tree claiming the event in a capture-phase listener.
    const claim = (e: MouseEvent) => e.preventDefault();
    document.addEventListener("contextmenu", claim, { capture: true });
    const { result } = renderHook(() => useContextMenu(baseActions));

    act(() => {
      fireContextMenu(document);
    });

    expect(result.current.menu).toBeNull();
    document.removeEventListener("contextmenu", claim, { capture: true });
  });

  it("close() clears the open menu", () => {
    const { result } = renderHook(() => useContextMenu(baseActions));
    act(() => {
      fireContextMenu(document);
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
