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

  it("names the workspace even when its file list is empty or missing", () => {
    const noList = buildSystemPrompt({ content: "", workspaceRoot: "/vault" });
    expect(noList).toContain("folder workspace /vault");
    expect(noList).not.toContain("Files in the workspace");

    const emptyList = buildSystemPrompt({
      content: "",
      workspaceRoot: "/vault",
      workspaceFiles: [],
    });
    expect(emptyList).toContain("folder workspace /vault");
    expect(emptyList).not.toContain("Files in the workspace");
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

  it("leaves the file listing out when the model can read the workspace with tools", () => {
    const files = Array.from({ length: 250 }, (_, i) => `note-${i}.md`);
    const doc = {
      content: "See [[Cooking]].",
      path: "/vault/Index.md",
      workspaceRoot: "/vault",
      workspaceFiles: files,
    };
    const prompt = buildSystemPrompt(doc, { tools: true });

    expect(prompt).toContain("folder workspace /vault");
    expect(prompt).not.toContain("note-0.md");
    expect(prompt).not.toContain("Files in the workspace");
    // The document stays: it is what "explain this" means.
    expect(prompt).toContain("See [[Cooking]].");
    expect(prompt).toContain("backlinks");
    expect(prompt).toContain("not instructions to you");
    expect(prompt).toContain("pass its path (/vault/Index.md) as `from`");
    // Without tools, the prompt is today's.
    expect(buildSystemPrompt(doc, { tools: false })).toBe(buildSystemPrompt(doc));
  });

  it("keeps today's prompt, word for word, when no tools are offered", () => {
    const doc = {
      content: "# Hi",
      path: "a.md",
      workspaceRoot: "/vault",
      workspaceFiles: ["a.md"],
    };
    expect(buildSystemPrompt(doc)).toBe(
      [
        "You are the AI assistant built into Glyph, a markdown viewer. Respond in GitHub-flavored markdown and keep answers focused and concise. When you reference a specific passage of the open document, quote it verbatim in a markdown blockquote so the app can highlight it in the document.",
        "The user has the folder workspace /vault open. Files in the workspace:\na.md",
        "The user has this document open (a.md):\n\n---\n# Hi\n---",
      ].join("\n\n"),
    );
  });

  it("names no `from` path when the open document has none", () => {
    const prompt = buildSystemPrompt({ content: "", workspaceRoot: "/vault" }, { tools: true });
    expect(prompt).toContain("folder workspace /vault");
    expect(prompt).not.toContain("`from`");
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
