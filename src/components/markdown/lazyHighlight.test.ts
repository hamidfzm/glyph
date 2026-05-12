import { describe, expect, it } from "vitest";
import { hasCodeBlock, loadHighlight } from "./lazyHighlight";

describe("hasCodeBlock", () => {
  it("returns true for triple-backtick fences", () => {
    expect(hasCodeBlock("intro\n```js\ncode\n```\n")).toBe(true);
  });

  it("returns true for tilde fences", () => {
    expect(hasCodeBlock("intro\n~~~js\ncode\n~~~\n")).toBe(true);
  });

  it("returns false when there is no fence at the start of a line", () => {
    expect(hasCodeBlock("just text with ``` inline pseudo code")).toBe(false);
  });

  it("returns false for empty input", () => {
    expect(hasCodeBlock("")).toBe(false);
  });
});

describe("loadHighlight", () => {
  it("caches the returned plugin between calls", async () => {
    const a = await loadHighlight();
    const b = await loadHighlight();
    expect(a).toBe(b);
    expect(typeof a).toBe("function");
  });
});
