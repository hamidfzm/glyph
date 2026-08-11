import { describe, expect, it } from "vitest";
import { hasEmojiShortcode, loadGemoji } from "./lazyGemoji";

describe("hasEmojiShortcode", () => {
  it("matches word shortcodes", () => {
    expect(hasEmojiShortcode("hello :smile: world")).toBe(true);
  });

  it("matches plus and minus shortcodes", () => {
    expect(hasEmojiShortcode("nice :+1:")).toBe(true);
    expect(hasEmojiShortcode("nope :-1:")).toBe(true);
  });

  it("returns false for plain prose", () => {
    expect(hasEmojiShortcode("just words, no codes")).toBe(false);
  });

  it("returns false for a lone colon pair with a space between", () => {
    expect(hasEmojiShortcode("a : b : c")).toBe(false);
  });
});

describe("loadGemoji", () => {
  it("caches the returned plugin between calls", async () => {
    const a = await loadGemoji();
    const b = await loadGemoji();
    expect(a).toBe(b);
    expect(typeof a).toBe("function");
  });
});
