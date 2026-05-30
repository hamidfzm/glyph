import { describe, expect, it } from "vitest";
import { parseDelimited } from "./parseDelimited";

describe("parseDelimited", () => {
  it("parses simple comma-separated rows", () => {
    expect(parseDelimited("a,b,c\n1,2,3", ",")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("parses tab-separated rows", () => {
    expect(parseDelimited("a\tb\n1\t2", "\t")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("handles quoted fields with embedded delimiters", () => {
    expect(parseDelimited('"a,b",c', ",")).toEqual([["a,b", "c"]]);
  });

  it("handles escaped quotes inside quoted fields", () => {
    expect(parseDelimited('"she said ""hi""",x', ",")).toEqual([['she said "hi"', "x"]]);
  });

  it("handles newlines inside quoted fields", () => {
    expect(parseDelimited('"line1\nline2",b', ",")).toEqual([["line1\nline2", "b"]]);
  });

  it("handles CRLF line endings", () => {
    expect(parseDelimited("a,b\r\n1,2", ",")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("preserves empty trailing fields", () => {
    expect(parseDelimited("a,,c", ",")).toEqual([["a", "", "c"]]);
  });

  it("returns an empty array for empty input", () => {
    expect(parseDelimited("", ",")).toEqual([]);
  });

  it("ignores a trailing newline", () => {
    expect(parseDelimited("a,b\n", ",")).toEqual([["a", "b"]]);
  });
});
