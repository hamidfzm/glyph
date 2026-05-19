import { describe, expect, it } from "vitest";
import { fuzzyMatch } from "./fuzzyMatch";

describe("fuzzyMatch", () => {
  it("returns 0-score empty-indices match for an empty query", () => {
    expect(fuzzyMatch("", "anything")).toEqual({ score: 0, indices: [] });
  });

  it("returns null when target is empty and query is not", () => {
    expect(fuzzyMatch("abc", "")).toBeNull();
  });

  it("returns null when characters don't appear in order", () => {
    expect(fuzzyMatch("xyz", "hello world")).toBeNull();
    expect(fuzzyMatch("cba", "abc")).toBeNull();
  });

  it("matches consecutive characters at the start of a string", () => {
    const result = fuzzyMatch("hel", "hello");
    expect(result).not.toBeNull();
    expect(result?.indices).toEqual([0, 1, 2]);
  });

  it("matches characters at word boundaries", () => {
    const result = fuzzyMatch("of", "open file");
    expect(result).not.toBeNull();
    expect(result?.indices).toEqual([0, 5]);
  });

  it("is case insensitive", () => {
    const result = fuzzyMatch("OF", "open file");
    expect(result).not.toBeNull();
  });

  it("scores prefix matches higher than middle matches", () => {
    const start = fuzzyMatch("file", "file.md")!;
    const middle = fuzzyMatch("file", "open file dialog")!;
    expect(start.score).toBeGreaterThan(middle.score);
  });

  it("scores consecutive matches higher than scattered ones", () => {
    const consecutive = fuzzyMatch("note", "note.md")!;
    const scattered = fuzzyMatch("note", "n_o_t_e.md")!;
    expect(consecutive.score).toBeGreaterThan(scattered.score);
  });

  it("scores word-boundary matches higher than mid-word", () => {
    const boundary = fuzzyMatch("ti", "tab item")!;
    const midWord = fuzzyMatch("ti", "active")!;
    expect(boundary.score).toBeGreaterThan(midWord.score);
  });

  it("returns indices that point at the actual matched chars", () => {
    const result = fuzzyMatch("cnf", "command-find")!;
    expect(result.indices.map((i) => "command-find"[i])).toEqual(["c", "n", "f"]);
  });

  it("handles long inputs via the greedy fallback without throwing", () => {
    const target = `${"a".repeat(1000)}b`;
    const result = fuzzyMatch("ab", target);
    expect(result).not.toBeNull();
  });

  it("recognizes camelCase boundaries", () => {
    const camel = fuzzyMatch("ot", "openTab")!;
    const flat = fuzzyMatch("ot", "opentab")!;
    expect(camel.score).toBeGreaterThan(flat.score);
  });
});
