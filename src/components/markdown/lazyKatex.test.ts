import { describe, expect, it } from "vitest";
import { hasMath, loadKatex } from "./lazyKatex";

describe("hasMath", () => {
  it("matches inline dollar math", () => {
    expect(hasMath("text $a + b$ more")).toBe(true);
  });

  it("matches block double-dollar math across lines", () => {
    expect(hasMath("$$\na^2 + b^2 = c^2\n$$")).toBe(true);
  });

  it("matches \\( ... \\) delimiters", () => {
    expect(hasMath("text \\(x\\) more")).toBe(true);
  });

  it("matches \\[ ... \\] delimiters", () => {
    expect(hasMath("text \\[x = 1\\] more")).toBe(true);
  });

  it("ignores escaped dollar signs", () => {
    expect(hasMath("price is \\$5")).toBe(false);
  });

  it("returns false for plain prose", () => {
    expect(hasMath("just words and numbers 42")).toBe(false);
  });
});

describe("loadKatex", () => {
  it("caches the returned plugin between calls", async () => {
    const a = await loadKatex();
    const b = await loadKatex();
    expect(a).toBe(b);
  });
});
