import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useTabReorderShortcuts } from "./useTabReorderShortcuts";

function dispatch(init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true });
  document.dispatchEvent(event);
  return event;
}

describe("useTabReorderShortcuts", () => {
  it("moves left on CmdOrCtrl+Shift+PageUp", () => {
    const onMove = vi.fn();
    renderHook(() => useTabReorderShortcuts({ platform: "macos", onMove }));
    const event = dispatch({ code: "PageUp", key: "PageUp", metaKey: true, shiftKey: true });
    expect(onMove).toHaveBeenCalledWith(-1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("moves right on CmdOrCtrl+Shift+PageDown", () => {
    const onMove = vi.fn();
    renderHook(() => useTabReorderShortcuts({ platform: "windows", onMove }));
    const event = dispatch({ code: "PageDown", key: "PageDown", ctrlKey: true, shiftKey: true });
    expect(onMove).toHaveBeenCalledWith(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("requires the primary modifier of the current platform", () => {
    const onMove = vi.fn();
    renderHook(() => useTabReorderShortcuts({ platform: "macos", onMove }));
    // Ctrl on macOS is not CmdOrCtrl; the binding must not fire.
    dispatch({ code: "PageUp", key: "PageUp", ctrlKey: true, shiftKey: true });
    expect(onMove).not.toHaveBeenCalled();
  });

  it("ignores keys that match neither binding", () => {
    const onMove = vi.fn();
    renderHook(() => useTabReorderShortcuts({ platform: "macos", onMove }));
    const event = dispatch({ code: "PageUp", key: "PageUp", metaKey: true }); // no Shift
    dispatch({ code: "KeyA", key: "a", metaKey: true, shiftKey: true });
    expect(onMove).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("stops listening after unmount", () => {
    const onMove = vi.fn();
    const { unmount } = renderHook(() => useTabReorderShortcuts({ platform: "macos", onMove }));
    unmount();
    dispatch({ code: "PageUp", key: "PageUp", metaKey: true, shiftKey: true });
    expect(onMove).not.toHaveBeenCalled();
  });
});
