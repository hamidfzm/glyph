import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { scanWords } from "./wordScanner";

function wordsOf(doc: string): string[] {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage })],
  });
  return scanWords(state, 0, doc.length).map((token) => token.word);
}

describe("scanWords", () => {
  it("returns prose words with accurate positions", () => {
    const state = EditorState.create({
      doc: "helo wrld",
      extensions: [markdown({ base: markdownLanguage })],
    });
    const tokens = scanWords(state, 0, 9);
    expect(tokens).toEqual([
      { from: 0, to: 4, word: "helo" },
      { from: 5, to: 9, word: "wrld" },
    ]);
  });

  it("keeps apostrophes and internal hyphens in one token", () => {
    expect(wordsOf("don't well-being")).toEqual(["don't", "well-being"]);
  });

  it("skips all-caps acronyms, digit-bearing tokens, and single letters", () => {
    expect(wordsOf("HTML a x9 word")).toEqual(["word"]);
  });

  it("excludes fenced code blocks", () => {
    expect(wordsOf("real prose\n```\nbadcode\n```\n")).toEqual(["real", "prose"]);
  });

  it("excludes inline code", () => {
    expect(wordsOf("text `codeword` more")).toEqual(["text", "more"]);
  });

  it("excludes link targets but keeps link text", () => {
    expect(wordsOf("[clik](http://exmaple.test)")).toEqual(["clik"]);
  });

  it("excludes autolinked URLs", () => {
    expect(wordsOf("see <http://exmaple.test>")).toEqual(["see"]);
  });

  it("excludes YAML frontmatter", () => {
    expect(wordsOf("---\ntitel: xyz\n---\nreal wrods")).toEqual(["real", "wrods"]);
  });

  it("excludes frontmatter closed with a ... fence", () => {
    expect(wordsOf("---\ntitel: xyz\n...\nreal wrods")).toEqual(["real", "wrods"]);
  });

  it("treats an unterminated frontmatter block as prose", () => {
    // No closing fence, so the leading --- is not frontmatter and its lines are checked.
    expect(wordsOf("---\ntitel: xyz\nmore wrods")).toEqual(["titel", "xyz", "more", "wrods"]);
  });
});
