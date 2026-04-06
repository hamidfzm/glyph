import { describe, expect, it } from "vitest";
import { countWords, readingTime } from "./markdown";

describe("countWords", () => {
  it("counts words in plain text", () => {
    expect(countWords("hello world")).toBe(2);
  });

  it("returns 0 for empty string", () => {
    expect(countWords("")).toBe(0);
  });

  it("returns 0 for whitespace-only string", () => {
    expect(countWords("   \n\t  ")).toBe(0);
  });

  it("strips fenced code blocks", () => {
    const text = "before\n```\ncode here\n```\nafter";
    expect(countWords(text)).toBe(2);
  });

  it("strips inline code", () => {
    const text = "use `console.log` to debug";
    expect(countWords(text)).toBe(3);
  });

  it("strips markdown formatting characters", () => {
    const text = "# Heading\n**bold** and *italic*";
    expect(countWords(text)).toBe(4);
  });

  it("handles multiple spaces and newlines", () => {
    const text = "word1   word2\n\nword3\tword4";
    expect(countWords(text)).toBe(4);
  });

  it("handles complex markdown", () => {
    const text = "## Title\n- [link](url)\n> quote\n| table |";
    const count = countWords(text);
    expect(count).toBeGreaterThan(0);
  });

  it("handles markdown with multiple code blocks", () => {
    const text = "start\n```js\nconst a = 1;\n```\nmiddle\n```py\nprint('hi')\n```\nend";
    expect(countWords(text)).toBe(3);
  });
});

describe("readingTime", () => {
  it("returns 1 min for small word counts", () => {
    expect(readingTime(0)).toBe("1 min read");
    expect(readingTime(1)).toBe("1 min read");
    expect(readingTime(100)).toBe("1 min read");
    expect(readingTime(230)).toBe("1 min read");
  });

  it("returns 2 min for 231-460 words", () => {
    expect(readingTime(231)).toBe("2 min read");
    expect(readingTime(460)).toBe("2 min read");
  });

  it("returns correct time for longer texts", () => {
    expect(readingTime(690)).toBe("3 min read");
    expect(readingTime(2300)).toBe("10 min read");
  });

  it("always returns at least 1 min", () => {
    expect(readingTime(-10)).toBe("1 min read");
  });
});
