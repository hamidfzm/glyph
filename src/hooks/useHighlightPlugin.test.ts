import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useHighlightPlugin } from "./useHighlightPlugin";

const { loadHighlight, hasCodeBlock } = vi.hoisted(() => ({
  loadHighlight: vi.fn(),
  hasCodeBlock: vi.fn(),
}));

vi.mock("@/components/markdown/lazyHighlight", () => ({
  hasCodeBlock,
  loadHighlight,
  HIGHLIGHT_OPTIONS: { plainText: ["mermaid", "csv", "tsv"] },
}));

describe("useHighlightPlugin", () => {
  it("returns null and skips loading when there is no code block", () => {
    hasCodeBlock.mockReturnValue(false);
    const { result } = renderHook(() => useHighlightPlugin("plain text"));
    expect(result.current).toBeNull();
    expect(loadHighlight).not.toHaveBeenCalled();
  });

  it("loads the plugin and treats mermaid, csv, and tsv as plain text", async () => {
    const fakePlugin = Symbol("rehype-highlight");
    hasCodeBlock.mockReturnValue(true);
    loadHighlight.mockResolvedValue(fakePlugin);

    const { result } = renderHook(() => useHighlightPlugin("```csv\na,b\n```"));

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current).toEqual([fakePlugin, { plainText: ["mermaid", "csv", "tsv"] }]);
  });
});
