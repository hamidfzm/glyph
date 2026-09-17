import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { registerFileType } from "@/lib/plugins/fileTypes";
import { useDocumentMarkdown } from "./useDocumentMarkdown";

describe("useDocumentMarkdown", () => {
  it("passes markdown and path-less content through", () => {
    expect(renderHook(() => useDocumentMarkdown("/p/a.md", "# Hi")).result.current).toBe("# Hi");
    expect(renderHook(() => useDocumentMarkdown(undefined, "x")).result.current).toBe("x");
  });

  it("re-fences an open source document when a plugin claims or releases its extension", () => {
    const { result } = renderHook(() => useDocumentMarkdown("/p/a.d2", "x -> y"));
    expect(result.current).toBe("```\nx -> y\n```\n");

    let dispose = () => {};
    act(() => {
      dispose = registerFileType({ extensions: ["d2"], language: "d2" });
    });
    expect(result.current).toBe("```d2\nx -> y\n```\n");

    act(() => dispose());
    expect(result.current).toBe("```\nx -> y\n```\n");
  });
});
