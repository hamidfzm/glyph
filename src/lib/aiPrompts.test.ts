import { describe, expect, it } from "vitest";
import { AI_ACTIONS, actionPrompt, buildSystemPrompt } from "./aiPrompts";

describe("buildSystemPrompt", () => {
  it("returns the base prompt when there is no document", () => {
    const base = buildSystemPrompt(null);
    expect(base).toContain("markdown viewer");
    expect(base).toContain("blockquote");
    expect(buildSystemPrompt({ content: "" })).toBe(base);
  });

  it("embeds the document content and path", () => {
    const prompt = buildSystemPrompt({ content: "# Hello", path: "notes/hello.md" });
    expect(prompt).toContain("# Hello");
    expect(prompt).toContain("(notes/hello.md)");
  });

  it("omits the path parenthetical when no path is given", () => {
    const prompt = buildSystemPrompt({ content: "# Hello" });
    expect(prompt).toContain("# Hello");
    expect(prompt).not.toContain("()");
  });

  it("truncates oversized documents with an explicit note", () => {
    const prompt = buildSystemPrompt({ content: "x".repeat(30_000) });
    expect(prompt).toContain("[Document truncated]");
    expect(prompt.length).toBeLessThan(26_000);
  });
});

describe("actionPrompt", () => {
  it("refers to the open document when no selection is passed", () => {
    expect(actionPrompt("summarize")).toMatch(/open document/);
    expect(actionPrompt("explain")).toMatch(/open document/);
    expect(actionPrompt("translate")).toMatch(/translate/i);
    expect(actionPrompt("simplify")).toMatch(/simple words/i);
  });

  it("embeds the selection for every action", () => {
    for (const action of AI_ACTIONS) {
      const prompt = actionPrompt(action, "the passage");
      expect(prompt).toContain("the passage");
      expect(prompt).not.toMatch(/open document/);
    }
  });
});
