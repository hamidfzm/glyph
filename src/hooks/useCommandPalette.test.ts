import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useCommandPalette } from "./useCommandPalette";

function dispatch(init: KeyboardEventInit, target?: Element) {
  const event = new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true });
  Object.defineProperty(event, "target", { value: target ?? document.body });
  act(() => {
    document.dispatchEvent(event);
  });
  return event;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useCommandPalette", () => {
  it("starts closed with an empty query", () => {
    const { result } = renderHook(() => useCommandPalette({ platform: "macos" }));
    expect(result.current.open).toBe(false);
    expect(result.current.query).toBe("");
  });

  it("opens on Cmd+K (macOS)", () => {
    const { result } = renderHook(() => useCommandPalette({ platform: "macos" }));
    const event = dispatch({ key: "k", metaKey: true });
    expect(result.current.open).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it("opens on Ctrl+K (windows / linux)", () => {
    const { result } = renderHook(() => useCommandPalette({ platform: "linux" }));
    dispatch({ key: "k", ctrlKey: true });
    expect(result.current.open).toBe(true);
  });

  it("toggles closed on repeat shortcut", () => {
    const { result } = renderHook(() => useCommandPalette({ platform: "macos" }));
    dispatch({ key: "k", metaKey: true });
    expect(result.current.open).toBe(true);
    dispatch({ key: "k", metaKey: true });
    expect(result.current.open).toBe(false);
  });

  it("does not steal Cmd+K when focus is inside .cm-editor", () => {
    const editor = document.createElement("div");
    editor.className = "cm-editor";
    document.body.appendChild(editor);
    const { result } = renderHook(() => useCommandPalette({ platform: "macos" }));
    const event = dispatch({ key: "k", metaKey: true }, editor);
    expect(result.current.open).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it("clears the query when opened via the shortcut", () => {
    const { result } = renderHook(() => useCommandPalette({ platform: "macos" }));
    act(() => result.current.openPalette());
    act(() => result.current.setQuery("foo"));
    expect(result.current.query).toBe("foo");
    act(() => result.current.closePalette());
    dispatch({ key: "k", metaKey: true });
    expect(result.current.open).toBe(true);
    expect(result.current.query).toBe("");
  });

  it("closePalette closes without changing the query", () => {
    const { result } = renderHook(() => useCommandPalette({ platform: "macos" }));
    act(() => result.current.openPalette());
    act(() => result.current.setQuery("file"));
    act(() => result.current.closePalette());
    expect(result.current.open).toBe(false);
    expect(result.current.query).toBe("file");
  });

  it("ignores keys that don't match the palette shortcut", () => {
    const { result } = renderHook(() => useCommandPalette({ platform: "macos" }));
    dispatch({ key: "k" });
    expect(result.current.open).toBe(false);
    dispatch({ key: "k", metaKey: true, shiftKey: true });
    expect(result.current.open).toBe(false);
    dispatch({ key: "j", metaKey: true });
    expect(result.current.open).toBe(false);
  });

  it("openPalette clears the previous query", () => {
    const { result } = renderHook(() => useCommandPalette({ platform: "macos" }));
    act(() => result.current.openPalette());
    act(() => result.current.setQuery("stale"));
    act(() => result.current.closePalette());
    act(() => result.current.openPalette());
    expect(result.current.open).toBe(true);
    expect(result.current.query).toBe("");
  });
});
