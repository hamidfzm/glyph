import { describe, expect, it } from "vitest";
import { AI_ACTIONS, actionPrompt, aiDocContext, buildSystemPrompt } from "./aiPrompts";

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

  it("tells the model about a non-text active file instead of staying silent", () => {
    const prompt = buildSystemPrompt({ content: "", path: "assets/ship.png" });
    expect(prompt).toContain("assets/ship.png");
    expect(prompt).toContain("not readable text");
  });

  it("lists the workspace files when a folder is open", () => {
    const prompt = buildSystemPrompt({
      content: "# Doc",
      path: "Notes/doc.md",
      workspaceRoot: "/vault",
      workspaceFiles: ["Notes/doc.md", "Index.md"],
    });
    expect(prompt).toContain("folder workspace /vault");
    expect(prompt).toContain("Index.md");
    expect(prompt).toContain("# Doc");
  });

  it("elides very large workspaces with a count", () => {
    const files = Array.from({ length: 250 }, (_, i) => `note-${i}.md`);
    const prompt = buildSystemPrompt({
      content: "",
      workspaceRoot: "/vault",
      workspaceFiles: files,
    });
    expect(prompt).toContain("note-199.md");
    expect(prompt).not.toContain("note-200.md");
    expect(prompt).toContain("[and 50 more]");
  });
});

describe("aiDocContext", () => {
  it("returns null when nothing is open", () => {
    expect(aiDocContext({ content: null })).toBeNull();
  });

  it("keeps a content-less file path so the model knows what is open", () => {
    expect(aiDocContext({ path: "a.png", content: null })).toEqual({
      content: "",
      path: "a.png",
      workspaceRoot: undefined,
      workspaceFiles: undefined,
    });
  });

  it("only carries workspace files alongside a workspace root", () => {
    const ctx = aiDocContext({ content: "x", workspaceFiles: ["a.md"] });
    expect(ctx?.workspaceFiles).toBeUndefined();
    const wsCtx = aiDocContext({ content: "x", workspaceRoot: "/v", workspaceFiles: ["a.md"] });
    expect(wsCtx?.workspaceFiles).toEqual(["a.md"]);
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
