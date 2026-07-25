import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useZoomShortcuts } from "./useZoomShortcuts";

function dispatch(init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true });
  document.dispatchEvent(event);
  return event;
}

function setup(platform: "macos" | "windows" = "windows") {
  const handlers = { onZoomIn: vi.fn(), onZoomOut: vi.fn(), onZoomReset: vi.fn() };
  const view = renderHook(() => useZoomShortcuts({ platform, ...handlers }));
  return { ...view, ...handlers };
}

describe("useZoomShortcuts", () => {
  // Regression: zoom relied solely on the native menu accelerator, which the
  // WebView2 child window swallows on Windows, so the keys did nothing while
  // the menu items still worked by click.
  it("zooms in on Ctrl+=", () => {
    const { onZoomIn } = setup();
    const event = dispatch({ code: "Equal", key: "=", ctrlKey: true });
    expect(onZoomIn).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it("zooms out on Ctrl+-", () => {
    const { onZoomOut } = setup();
    const event = dispatch({ code: "Minus", key: "-", ctrlKey: true });
    expect(onZoomOut).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it("resets zoom on Ctrl+0", () => {
    const { onZoomReset } = setup();
    const event = dispatch({ code: "Digit0", key: "0", ctrlKey: true });
    expect(onZoomReset).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it("uses the platform's primary modifier", () => {
    const { onZoomIn } = setup("macos");
    dispatch({ code: "Equal", key: "=", ctrlKey: true }); // Ctrl is not CmdOrCtrl on macOS
    expect(onZoomIn).not.toHaveBeenCalled();
    dispatch({ code: "Equal", key: "=", metaKey: true });
    expect(onZoomIn).toHaveBeenCalledOnce();
  });

  it("ignores the keys without the modifier", () => {
    const { onZoomIn, onZoomOut, onZoomReset } = setup();
    const event = dispatch({ code: "Equal", key: "=" });
    dispatch({ code: "Minus", key: "-" });
    dispatch({ code: "Digit0", key: "0" });
    expect(onZoomIn).not.toHaveBeenCalled();
    expect(onZoomOut).not.toHaveBeenCalled();
    expect(onZoomReset).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("stops listening after unmount", () => {
    const { unmount, onZoomIn } = setup();
    unmount();
    dispatch({ code: "Equal", key: "=", ctrlKey: true });
    expect(onZoomIn).not.toHaveBeenCalled();
  });
});
