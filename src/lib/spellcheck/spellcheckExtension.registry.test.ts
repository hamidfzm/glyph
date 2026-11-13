import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearDictionarySources, registerDictionarySource } from "./dictionarySources";
import {
  clearSpellcheckEngines,
  registerSpellcheckEngine,
  type SpellcheckEngine,
} from "./spellcheckEngines";
import { buildSpellcheck } from "./spellcheckExtension";
import { clearSpellerCache } from "./speller";

// The extension with the real speller cache and registries, which its own
// tests mock away: an editor reloading on a registry change must get the new
// checker, never the one being freed. The stand-in engine accepts the words its
// .dic lists, plus any it was built to accept.
function engineAccepting(...extra: string[]): SpellcheckEngine {
  return {
    create: async (_aff, dic) => {
      const words = [...dic.split("\n").slice(1), ...extra];
      return { correct: (word) => words.includes(word), suggest: () => [], add: vi.fn() };
    },
  };
}

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

describe("spell check following the dictionary and engine registries", () => {
  beforeEach(() => {
    clearDictionarySources();
    clearSpellcheckEngines();
    clearSpellerCache();
    registerSpellcheckEngine(engineAccepting());
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

  it("checks with a new engine, and with the old one again once it goes", async () => {
    registerEnglish(["world"]);
    const view = mount("helo world");
    await vi.waitFor(() => expect(markedWords(view)).toEqual(["helo"]));

    const removeEngine = registerSpellcheckEngine(engineAccepting("helo"));
    await vi.waitFor(() => expect(markedWords(view)).toEqual([]));

    removeEngine();
    await vi.waitFor(() => expect(markedWords(view)).toEqual(["helo"]));
    view.destroy();
  });
});
