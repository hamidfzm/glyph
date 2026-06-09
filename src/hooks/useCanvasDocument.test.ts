import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { parseCanvas } from "@/lib/canvas/parse";
import type { CanvasData } from "@/lib/canvas/types";
import { useCanvasDocument } from "./useCanvasDocument";

const board = (text: string): string =>
  JSON.stringify({
    nodes: [{ id: "a", type: "text", x: 0, y: 0, width: 100, height: 50, text }],
    edges: [],
  });

describe("useCanvasDocument", () => {
  it("parses initial content", () => {
    const { result } = renderHook(() => useCanvasDocument(board("hi"), vi.fn()));
    expect(result.current.data.nodes[0]).toMatchObject({ id: "a", text: "hi" });
  });

  it("falls back to an empty board on invalid JSON", () => {
    const { result } = renderHook(() => useCanvasDocument("{bad", vi.fn()));
    expect(result.current.data).toEqual({ nodes: [], edges: [] });
  });

  it("commit serializes and notifies, without reparsing the echo", () => {
    const onCommit = vi.fn();
    const { result, rerender } = renderHook(
      ({ content }: { content: string }) => useCanvasDocument(content, onCommit),
      { initialProps: { content: board("hi") } },
    );

    const next: CanvasData = {
      nodes: [{ id: "a", type: "text", x: 0, y: 0, width: 100, height: 50, text: "bye" }],
      edges: [],
    };
    act(() => result.current.commit(next));

    expect(onCommit).toHaveBeenCalledTimes(1);
    const serialized = onCommit.mock.calls[0][0];
    expect(parseCanvas(serialized).nodes[0]).toMatchObject({ text: "bye" });

    // Echoing that serialized string back as content must NOT reset state.
    rerender({ content: serialized });
    expect(result.current.data.nodes[0]).toMatchObject({ text: "bye" });
  });

  it("re-parses when content changes from outside (undo/redo)", () => {
    const { result, rerender } = renderHook(
      ({ content }: { content: string }) => useCanvasDocument(content, vi.fn()),
      { initialProps: { content: board("one") } },
    );
    rerender({ content: board("two") });
    expect(result.current.data.nodes[0]).toMatchObject({ text: "two" });
  });
});
