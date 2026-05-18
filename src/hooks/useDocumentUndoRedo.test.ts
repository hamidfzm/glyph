import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDocumentUndoRedo } from "./useDocumentUndoRedo";

function dispatch(init: KeyboardEventInit, target?: Element) {
  const event = new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true });
  // KeyboardEvent.target is read-only after dispatch; tests need to assert from
  // a chosen element, so override the getter.
  Object.defineProperty(event, "target", { value: target ?? document.body });
  document.dispatchEvent(event);
  return event;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useDocumentUndoRedo", () => {
  it("calls onUndo for Cmd+Z on macOS when focus is outside the editor", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    renderHook(() =>
      useDocumentUndoRedo({ activeTabId: "tab-1", platform: "macos", onUndo, onRedo }),
    );
    const event = dispatch({ key: "z", metaKey: true });
    expect(onUndo).toHaveBeenCalledWith("tab-1");
    expect(onRedo).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it("calls onRedo for Shift+Cmd+Z", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    renderHook(() =>
      useDocumentUndoRedo({ activeTabId: "tab-1", platform: "macos", onUndo, onRedo }),
    );
    dispatch({ key: "z", metaKey: true, shiftKey: true });
    expect(onRedo).toHaveBeenCalledWith("tab-1");
    expect(onUndo).not.toHaveBeenCalled();
  });

  it("defers to CodeMirror when focus is inside .cm-editor", () => {
    const editor = document.createElement("div");
    editor.className = "cm-editor";
    const input = document.createElement("textarea");
    editor.appendChild(input);
    document.body.appendChild(editor);

    const onUndo = vi.fn();
    const onRedo = vi.fn();
    renderHook(() =>
      useDocumentUndoRedo({ activeTabId: "tab-1", platform: "macos", onUndo, onRedo }),
    );
    const event = dispatch({ key: "z", metaKey: true }, input);
    expect(onUndo).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("is a no-op when no tab is active", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    renderHook(() => useDocumentUndoRedo({ activeTabId: null, platform: "macos", onUndo, onRedo }));
    dispatch({ key: "z", metaKey: true });
    expect(onUndo).not.toHaveBeenCalled();
  });

  it("ignores keys that do not match either shortcut", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    renderHook(() =>
      useDocumentUndoRedo({ activeTabId: "tab-1", platform: "macos", onUndo, onRedo }),
    );
    dispatch({ key: "a", metaKey: true });
    dispatch({ key: "z" }); // no modifier
    expect(onUndo).not.toHaveBeenCalled();
    expect(onRedo).not.toHaveBeenCalled();
  });
});
