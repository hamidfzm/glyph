import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  buildWikilinkCompletions,
  findWikilinkOpening,
  wikilinkCompletionSource,
} from "./wikilinkCompletion";

function stateWithCursor(doc: string, cursor: number) {
  return EditorState.create({ doc, selection: { anchor: cursor } });
}

describe("findWikilinkOpening", () => {
  it("finds the opening when cursor is right after [[", () => {
    const doc = "see [[";
    const state = stateWithCursor(doc, doc.length);
    const opening = findWikilinkOpening(state, state.selection.main.from);
    expect(opening).toEqual({ start: 4, typed: "" });
  });

  it("captures typed text between [[ and the cursor", () => {
    const doc = "see [[Cook";
    const state = stateWithCursor(doc, doc.length);
    expect(findWikilinkOpening(state, state.selection.main.from)?.typed).toBe("Cook");
  });

  it("returns null when there is no opening before the cursor", () => {
    const doc = "plain text";
    const state = stateWithCursor(doc, doc.length);
    expect(findWikilinkOpening(state, state.selection.main.from)).toBeNull();
  });

  it("returns null when the link is already closed before the cursor", () => {
    const doc = "see [[Cooking]] and ";
    const state = stateWithCursor(doc, doc.length);
    expect(findWikilinkOpening(state, state.selection.main.from)).toBeNull();
  });

  it("returns null inside the alias portion", () => {
    const doc = "[[Cooking|kitch";
    const state = stateWithCursor(doc, doc.length);
    expect(findWikilinkOpening(state, state.selection.main.from)).toBeNull();
  });

  it("returns null inside the heading portion", () => {
    const doc = "[[Cooking#Rec";
    const state = stateWithCursor(doc, doc.length);
    expect(findWikilinkOpening(state, state.selection.main.from)).toBeNull();
  });

  it("does not look back across newlines", () => {
    const doc = "[[Cooking\nhello";
    const state = stateWithCursor(doc, doc.length);
    expect(findWikilinkOpening(state, state.selection.main.from)).toBeNull();
  });
});

describe("buildWikilinkCompletions", () => {
  const files = [
    "/vault/Index.md",
    "/vault/Notes/Cooking.md",
    "/vault/Notes/Travel.md",
    "/vault/Archive/Travel.md",
  ];

  it("returns all files when the typed prefix is empty", () => {
    const completions = buildWikilinkCompletions(files, "/vault", "");
    expect(completions.map((c) => c.label).sort()).toEqual([
      "Cooking",
      "Index",
      "Travel",
      "Travel",
    ]);
  });

  it("matches by stem prefix case-insensitively", () => {
    const completions = buildWikilinkCompletions(files, "/vault", "co");
    expect(completions.map((c) => c.label)).toEqual(["Cooking"]);
  });

  it("falls back to relative-path substring match", () => {
    const completions = buildWikilinkCompletions(files, "/vault", "archive");
    expect(completions.map((c) => c.label)).toContain("Travel");
  });

  it("orders prefix matches ahead of substring matches", () => {
    const completions = buildWikilinkCompletions(
      ["/vault/Notes/recipes-cookbook.md", "/vault/Cookbook.md"],
      "/vault",
      "cook",
    );
    // Cookbook prefix-matches; recipes-cookbook only substring-matches.
    expect(completions[0].label).toBe("Cookbook");
    expect(completions[1].label).toBe("recipes-cookbook");
  });

  it("includes the relative path as detail when it differs from the stem", () => {
    const completions = buildWikilinkCompletions(files, "/vault", "");
    const cooking = completions.find((c) => c.label === "Cooking");
    expect(cooking?.detail).toBe("Notes/Cooking.md");
  });
});

function runSource(doc: string, cursor: number, files: string[], explicit = false) {
  const state = stateWithCursor(doc, cursor);
  const ctx = new CompletionContext(state, cursor, explicit);
  const source = wikilinkCompletionSource({ workspaceFiles: files, workspaceRoot: "/vault" });
  return source(ctx);
}

describe("wikilinkCompletionSource", () => {
  const files = ["/vault/Index.md", "/vault/Notes/Cooking.md"];

  it("returns null when there are no workspace files", () => {
    const result = runSource("see [[Co", 8, []);
    expect(result).toBeNull();
  });

  it("returns null on a bare [[ unless explicit", () => {
    const doc = "see [[";
    expect(runSource(doc, doc.length, files)).toBeNull();
    expect(runSource(doc, doc.length, files, true)).not.toBeNull();
  });

  it("anchors `from` to the position right after [[", () => {
    const doc = "see [[Co";
    const result = runSource(doc, doc.length, files);
    expect(result?.from).toBe(6);
    expect(result?.to).toBe(doc.length);
  });

  it("expands `to` over an existing closing ]] so it isn't duplicated", () => {
    const doc = "see [[Co]]";
    const result = runSource(doc, 8, files);
    expect(result?.to).toBe(10);
  });

  it("each completion appends `]]` to the inserted stem", () => {
    const doc = "see [[Co";
    const result = runSource(doc, doc.length, files);
    const cooking = result?.options.find((o) => o.label === "Cooking");
    expect(cooking?.apply).toBe("Cooking]]");
  });

  it("returns null when no completions match", () => {
    const result = runSource("see [[xyzzz", "see [[xyzzz".length, files);
    expect(result).toBeNull();
  });
});
