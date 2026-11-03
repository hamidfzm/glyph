import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The extension with the real speller cache and registry, which its own tests
// mock away: an editor reloading on a registry change must get the new
// source's checker, never the one being freed. The stand-in engine accepts the
// words its .dic lists, and once disposed accepts everything, like the real one.
vi.mock("./hunspellSpeller", () => ({
  createHunspellSpeller: (_aff: string, dic: string) => {
    const words = dic.split("\n").slice(1);
    let disposed = false;
    return Promise.resolve({
      correct: (word: string) => disposed || words.includes(word),
      suggest: () => [],
      add: () => {},
      dispose: () => {
        disposed = true;
      },
    });
  },
}));

import { clearDictionarySources, registerDictionarySource } from "./dictionarySources";
import { buildSpellcheck } from "./spellcheckExtension";
import { clearSpellerCache } from "./speller";

function registerEnglish(words: string[]): () => void {
  return registerDictionarySource({
    language: "en",
    label: "English",
    load: () => Promise.resolve({ aff: "", dic: `${words.length}\n${words.join("\n")}` }),
  });
}

function mount(doc: string): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const labels = () => ({ ignore: "Ignore", add: "Add", empty: "None" });
  return new EditorView({
    state: EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage }), buildSpellcheck(["en"], labels)],
    }),
    parent,
  });
}

function markedWords(view: EditorView): string[] {
  return [...view.contentDOM.querySelectorAll(".cm-misspelled")].map(
    (node) => node.textContent ?? "",
  );
}

describe("spell check following the dictionary registry", () => {
  beforeEach(() => {
    clearDictionarySources();
    clearSpellerCache();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("checks with a replacement dictionary, and with the old one again once it goes", async () => {
    registerEnglish(["world"]);
    const view = mount("helo world");
    await vi.waitFor(() => expect(markedWords(view)).toEqual(["helo"]));

    const removeReplacement = registerEnglish(["helo"]);
    await vi.waitFor(() => expect(markedWords(view)).toEqual(["world"]));

    removeReplacement();
    await vi.waitFor(() => expect(markedWords(view)).toEqual(["helo"]));
    view.destroy();
  });
});
