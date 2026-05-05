import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useTableOfContents } from "./useTableOfContents";

describe("useTableOfContents", () => {
  it("returns empty array for null content", () => {
    const { result } = renderHook(() => useTableOfContents(null));
    expect(result.current).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    const { result } = renderHook(() => useTableOfContents(""));
    expect(result.current).toEqual([]);
  });

  it("returns empty array for content without headings", () => {
    const { result } = renderHook(() => useTableOfContents("Just some text\nno headings here"));
    expect(result.current).toEqual([]);
  });

  it("parses a single heading", () => {
    const { result } = renderHook(() => useTableOfContents("# Hello World"));
    expect(result.current).toEqual([{ id: "hello-world", text: "Hello World", level: 1 }]);
  });

  it("parses multiple headings at different levels", () => {
    const content = "# Title\n## Section\n### Subsection\n#### Deep";
    const { result } = renderHook(() => useTableOfContents(content));
    expect(result.current).toHaveLength(4);
    expect(result.current[0]).toEqual({ id: "title", text: "Title", level: 1 });
    expect(result.current[1]).toEqual({ id: "section", text: "Section", level: 2 });
    expect(result.current[2]).toEqual({ id: "subsection", text: "Subsection", level: 3 });
    expect(result.current[3]).toEqual({ id: "deep", text: "Deep", level: 4 });
  });

  it("handles headings with special characters", () => {
    const content = "## Hello, World! (2024)";
    const { result } = renderHook(() => useTableOfContents(content));
    expect(result.current[0].id).toBe("hello-world-2024");
  });

  it("handles headings with mixed case", () => {
    const content = "## Getting Started";
    const { result } = renderHook(() => useTableOfContents(content));
    expect(result.current[0].id).toBe("getting-started");
  });

  it("ignores content between headings", () => {
    const content = "# First\nsome text\nparagraph\n## Second\nmore text";
    const { result } = renderHook(() => useTableOfContents(content));
    expect(result.current).toHaveLength(2);
  });

  it("supports h5 and h6", () => {
    const content = "##### H5\n###### H6";
    const { result } = renderHook(() => useTableOfContents(content));
    expect(result.current[0].level).toBe(5);
    expect(result.current[1].level).toBe(6);
  });

  it("memoizes result for same content", () => {
    const content = "# Test";
    const { result, rerender } = renderHook(() => useTableOfContents(content));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it("disambiguates duplicate heading slugs (matches GitHub)", () => {
    const content = "## Setup\n## Setup\n## Setup";
    const { result } = renderHook(() => useTableOfContents(content));
    expect(result.current.map((e) => e.id)).toEqual(["setup", "setup-1", "setup-2"]);
  });
});
