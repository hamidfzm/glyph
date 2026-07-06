import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";

const { getSpeller, spellerAdd } = vi.hoisted(() => {
  const spellerAdd = vi.fn();
  const speller = {
    correct: (word: string) => word.toLowerCase() === "world",
    suggest: (word: string) => (word.toLowerCase() === "helo" ? ["hello", "hell"] : []),
    add: spellerAdd,
  };
  return { getSpeller: vi.fn(() => Promise.resolve(speller)), spellerAdd };
});
vi.mock("./speller", () => ({ getSpeller }));

import { buildMisspellings, buildSpellcheck } from "./spellcheckExtension";

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

const labels = () => ({ ignore: "Ignore", add: "Add", empty: "None" });

function mount(doc: string, language: string): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  return new EditorView({
    state: EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage }), buildSpellcheck(language, labels)],
    }),
    parent,
  });
}

// Let the mocked getSpeller promise resolve and the plugin's initial scan run.
function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// The context-menu handler resolves the word from cursor coordinates; stub the
// coordinate lookup to a known offset so the test doesn't depend on layout.
function rightClickAt(view: EditorView, pos: number): void {
  vi.spyOn(view, "posAtCoords").mockReturnValue(pos);
  view.contentDOM.dispatchEvent(
    new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }),
  );
}

afterEach(() => {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  document.body.innerHTML = "";
  spellerAdd.mockClear();
});

describe("buildSpellcheck (editor integration)", () => {
  it("offers suggestions on a misspelled word and applies the chosen one", async () => {
    const view = mount("helo world", "lang-suggest");
    await flushMicrotasks();

    rightClickAt(view, 2); // inside "helo"
    expect(document.querySelector(".spellcheck-menu")).not.toBeNull();
    const items = document.querySelectorAll<HTMLButtonElement>(".spellcheck-menu-item");
    expect(items[0].textContent).toBe("hello");

    items[0].click();
    expect(view.state.doc.toString()).toBe("hello world");
    view.destroy();
  });

  it("does not open a menu on a correctly spelled word", async () => {
    const view = mount("helo world", "lang-correct");
    await flushMicrotasks();

    rightClickAt(view, 7); // inside "world"
    expect(document.querySelector(".spellcheck-menu")).toBeNull();
    view.destroy();
  });

  it("stops flagging a word after Ignore", async () => {
    const view = mount("helo world", "lang-ignore");
    await flushMicrotasks();

    rightClickAt(view, 2);
    document.querySelectorAll<HTMLButtonElement>(".spellcheck-menu-action")[0].click(); // Ignore
    rightClickAt(view, 2);
    expect(document.querySelector(".spellcheck-menu")).toBeNull();
    view.destroy();
  });

  it("adds a word to the dictionary from the menu", async () => {
    const view = mount("helo world", "lang-add");
    await flushMicrotasks();

    rightClickAt(view, 2);
    document.querySelectorAll<HTMLButtonElement>(".spellcheck-menu-action")[1].click(); // Add
    expect(spellerAdd).toHaveBeenCalledWith("helo");
    view.destroy();
  });

  it("rescans after the document changes", async () => {
    const view = mount("world", "lang-rescan");
    await flushMicrotasks();
    rightClickAt(view, 2);
    expect(document.querySelector(".spellcheck-menu")).toBeNull();

    view.dispatch({ changes: { from: 5, insert: " helo" } });
    await new Promise((resolve) => setTimeout(resolve, 350)); // past the scan debounce
    rightClickAt(view, 8); // inside the new "helo"
    expect(document.querySelector(".spellcheck-menu")).not.toBeNull();
    view.destroy();
  });

  it("ignores a right-click that is not over any text", async () => {
    const view = mount("helo world", "lang-nopos");
    await flushMicrotasks();
    vi.spyOn(view, "posAtCoords").mockReturnValue(null);
    view.contentDOM.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }),
    );
    expect(document.querySelector(".spellcheck-menu")).toBeNull();
    view.destroy();
  });

  it("shares ignored words across editors of the same language", async () => {
    const first = mount("helo world", "lang-share");
    await flushMicrotasks();
    rightClickAt(first, 2);
    document.querySelectorAll<HTMLButtonElement>(".spellcheck-menu-action")[0].click(); // Ignore
    first.destroy();

    const second = mount("helo world", "lang-share");
    await flushMicrotasks();
    rightClickAt(second, 2);
    expect(document.querySelector(".spellcheck-menu")).toBeNull(); // still ignored
    second.destroy();
  });

  it("does not scan until the dictionary has loaded", () => {
    getSpeller.mockReturnValueOnce(new Promise(() => {})); // never resolves
    vi.useFakeTimers();
    const view = mount("helo world", "lang-pending");
    view.dispatch({ changes: { from: 10, insert: " teh" } }); // schedules a debounced rescan
    vi.advanceTimersByTime(300); // rescan runs while the speller is still null
    vi.spyOn(view, "posAtCoords").mockReturnValue(2);
    view.contentDOM.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }),
    );
    expect(document.querySelector(".spellcheck-menu")).toBeNull();
    vi.useRealTimers();
    view.destroy();
  });
});
