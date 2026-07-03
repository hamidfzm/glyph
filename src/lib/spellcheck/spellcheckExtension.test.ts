import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { buildMisspellings } from "./spellcheckExtension";

const KNOWN = new Set(["world", "real", "prose"]);
const corrector = { correct: (word: string) => KNOWN.has(word.toLowerCase()) };

function stateOf(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
}

function markedWords(doc: string, ignored: Set<string> = new Set()): string[] {
  const state = stateOf(doc);
  const set = buildMisspellings(state, [{ from: 0, to: doc.length }], corrector, ignored);
  const words: string[] = [];
  set.between(0, doc.length, (from, to) => {
    words.push(doc.slice(from, to));
  });
  return words;
}

describe("buildMisspellings", () => {
  it("marks only words the corrector rejects", () => {
    expect(markedWords("helo world")).toEqual(["helo"]);
  });

  it("does not mark ignored words", () => {
    expect(markedWords("helo world", new Set(["helo"]))).toEqual([]);
  });

  it("never marks words inside code or frontmatter", () => {
    expect(markedWords("---\nbadfront: x\n---\nreal `badcode` prose")).toEqual([]);
  });
});
