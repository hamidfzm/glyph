import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MenuEventHandlers } from "./useMenuEvents";
import { useMenuShortcuts } from "./useMenuShortcuts";

function makeHandlers(): MenuEventHandlers {
  return {
    openFile: vi.fn(),
    openFolder: vi.fn(),
    openGraph: vi.fn(),
    save: vi.fn(),
    toggleAutoSave: vi.fn(),
    closeTab: vi.fn(),
    closeWorkspace: vi.fn(),
    toggleFilesSidebar: vi.fn(),
    toggleOutlineSidebar: vi.fn(),
    resetView: vi.fn(),
    openSettings: vi.fn(),
    openSyncSettings: vi.fn(),
    managePlugins: vi.fn(),
    find: vi.fn(),
    toggleEdit: vi.fn(),
    print: vi.fn(),
    exportHtml: vi.fn(),
    exportDocx: vi.fn(),
    exportEpub: vi.fn(),
    exportPdf: vi.fn(),
    exportWebsite: vi.fn(),
    workspaceSettings: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    zoomReset: vi.fn(),
    aiAction: vi.fn(),
    aiChat: vi.fn(),
    readAloud: vi.fn(),
    documentation: vi.fn(),
    releaseNotes: vi.fn(),
    reportIssue: vi.fn(),
  };
}

function dispatch(init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true });
  document.dispatchEvent(event);
  return event;
}

function setup(platform: "windows" | "macos" = "windows") {
  const handlers = makeHandlers();
  const view = renderHook(() => useMenuShortcuts({ platform, handlers }));
  return { ...view, handlers };
}

describe("useMenuShortcuts", () => {
  // Regression: every command whose only trigger was a native menu accelerator
  // (Open, Find, Print, zoom, ...) did nothing on Windows, because WebView2
  // consumes the keys before the menu sees them.
  it.each([
    ["opens a file on Ctrl+O", { code: "KeyO", key: "o" }, "openFile"],
    ["opens a folder on Ctrl+Shift+O", { code: "KeyO", key: "o", shiftKey: true }, "openFolder"],
    ["saves on Ctrl+S", { code: "KeyS", key: "s" }, "save"],
    ["prints on Ctrl+P", { code: "KeyP", key: "p" }, "print"],
    ["closes a tab on Ctrl+W", { code: "KeyW", key: "w" }, "closeTab"],
    ["finds on Ctrl+F", { code: "KeyF", key: "f" }, "find"],
    ["toggles the files sidebar on Ctrl+B", { code: "KeyB", key: "b" }, "toggleFilesSidebar"],
    ["toggles edit mode on Ctrl+E", { code: "KeyE", key: "e" }, "toggleEdit"],
    ["opens the graph on Ctrl+G", { code: "KeyG", key: "g" }, "openGraph"],
    ["opens settings on Ctrl+,", { code: "Comma", key: "," }, "openSettings"],
    ["zooms in on Ctrl+=", { code: "Equal", key: "=" }, "zoomIn"],
    ["zooms out on Ctrl+-", { code: "Minus", key: "-" }, "zoomOut"],
    ["resets zoom on Ctrl+0", { code: "Digit0", key: "0" }, "zoomReset"],
  ])("%s", (_name, init, handlerKey) => {
    const { handlers } = setup();
    const event = dispatch({ ...init, ctrlKey: true });
    expect(handlers[handlerKey as keyof MenuEventHandlers]).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves the command palette to its own listener so it cannot fire twice", () => {
    const { handlers } = setup();
    dispatch({ code: "KeyK", key: "k", ctrlKey: true });
    // The palette has a dedicated document listener; handling it here as well
    // would toggle it open and shut again.
    expect(handlers.openSettings).not.toHaveBeenCalled();
  });

  it("stays off on macOS, where the native accelerators are delivered", () => {
    const { handlers } = setup("macos");
    dispatch({ code: "KeyO", key: "o", metaKey: true });
    expect(handlers.openFile).not.toHaveBeenCalled();
  });

  it("ignores keys pressed without the modifier", () => {
    const { handlers } = setup();
    const event = dispatch({ code: "KeyO", key: "o" });
    expect(handlers.openFile).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("stops listening after unmount", () => {
    const { unmount, handlers } = setup();
    unmount();
    dispatch({ code: "KeyO", key: "o", ctrlKey: true });
    expect(handlers.openFile).not.toHaveBeenCalled();
  });
});
