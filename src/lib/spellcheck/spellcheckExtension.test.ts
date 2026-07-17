import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface FakeSpeller {
  correct: (word: string) => boolean;
  suggest: (word: string) => string[];
  add: ReturnType<typeof vi.fn>;
}

const { getSpeller, makeSpeller, spellers } = vi.hoisted(() => {
  const spellers = new Map<string, FakeSpeller>();
  const makeSpeller = (
    known: string[],
    suggestions: Record<string, string[]> = {},
  ): FakeSpeller => ({
    correct: (word: string) => known.includes(word),
    suggest: (word: string) => suggestions[word] ?? [],
    add: vi.fn(),
  });
  // Unknown languages stay pending forever, standing in for a dictionary that
  // has not finished loading.
  const getSpeller = vi.fn((language: string) => {
    const speller = spellers.get(language);
    return speller ? Promise.resolve(speller) : new Promise<FakeSpeller>(() => {});
  });
  return { getSpeller, makeSpeller, spellers };
});
vi.mock("./speller", () => ({ getSpeller }));

import { scriptCoverage } from "./scripts";
import {
  buildMisspellings,
  buildSpellcheck,
  type Checker,
  clearIgnoredWords,
} from "./spellcheckExtension";

// Persian test words (Arabic script): SALAM is "known", GHALAT plays the typo.
const SALAM = "سلام";
const GHALAT = "غلط";

const latinOnly = scriptCoverage(["Latn"]);
const arabicOnly = scriptCoverage(["Arab"]);
const enChecker: Checker = { covers: latinOnly, correct: (word) => word === "world" };
const faChecker: Checker = { covers: arabicOnly, correct: (word) => word === SALAM };

function stateOf(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
}

function markedWords(
  doc: string,
  checkers: readonly Checker[],
  ignored: Set<string> = new Set(),
): string[] {
  const state = stateOf(doc);
  const set = buildMisspellings(state, [{ from: 0, to: doc.length }], checkers, ignored);
  const words: string[] = [];
  set.between(0, doc.length, (from, to) => {
    words.push(doc.slice(from, to));
  });
  return words;
}

describe("buildMisspellings", () => {
  it("skips words in scripts no checker covers", () => {
    expect(markedWords(`helo world ${GHALAT}`, [enChecker])).toEqual(["helo"]);
  });

  it("checks each word only against checkers covering its script", () => {
    expect(markedWords(`helo world ${SALAM} ${GHALAT}`, [enChecker, faChecker])).toEqual([
      "helo",
      GHALAT,
    ]);
  });

  it("accepts a word when any covering checker accepts it", () => {
    const second: Checker = { covers: latinOnly, correct: (word) => word === "helo" };
    expect(markedWords("helo world", [enChecker, second])).toEqual([]);
  });

  it("skips ignored words", () => {
    expect(markedWords("helo world", [enChecker], new Set(["helo"]))).toEqual([]);
  });

  it("marks nothing with no checkers", () => {
    expect(markedWords("helo world", [])).toEqual([]);
  });
});

const labels = () => ({ ignore: "Ignore", add: "Add", empty: "None" });

function mount(doc: string, languages: readonly string[]): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  return new EditorView({
    state: EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage }), buildSpellcheck(languages, labels)],
    }),
    parent,
  });
}

// Let the mocked getSpeller promises resolve and the initial scans run.
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

function menuItems(): string[] {
  return [...document.querySelectorAll<HTMLButtonElement>(".spellcheck-menu-item")].map(
    (item) => item.textContent ?? "",
  );
}

// Suggestion entries only, excluding the Ignore/Add action buttons.
function suggestionItems(): string[] {
  return [
    ...document.querySelectorAll<HTMLButtonElement>(
      ".spellcheck-menu-item:not(.spellcheck-menu-action)",
    ),
  ].map((item) => item.textContent ?? "");
}

describe("buildSpellcheck (editor integration)", () => {
  beforeEach(() => {
    clearIgnoredWords();
    spellers.clear();
    spellers.set("en", makeSpeller(["world"], { helo: ["hello", "hell"] }));
    spellers.set("fa", makeSpeller([SALAM], { [GHALAT]: [SALAM] }));
    // A second Latin-script dictionary (unresolvable codes default to Latn).
    spellers.set("xx", makeSpeller(["helo"], { helo: ["hell", "halo"] }));
    getSpeller.mockClear();
  });

  afterEach(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    document.body.innerHTML = "";
  });

  it("with English only, Persian words are not flagged", async () => {
    const doc = `helo ${GHALAT}`;
    const view = mount(doc, ["en"]);
    await flushMicrotasks();

    rightClickAt(view, doc.length - 1); // inside the Persian word
    expect(document.querySelector(".spellcheck-menu")).toBeNull();
    rightClickAt(view, 2); // inside "helo"
    expect(document.querySelector(".spellcheck-menu")).not.toBeNull();
    view.destroy();
  });

  it("with English and Persian enabled, each word checks against its script's dictionary", async () => {
    const doc = `${SALAM} ${GHALAT}`;
    const view = mount(doc, ["en", "fa"]);
    await flushMicrotasks();

    rightClickAt(view, 2); // inside the accepted Persian word
    expect(document.querySelector(".spellcheck-menu")).toBeNull();
    rightClickAt(view, doc.length - 1); // inside the misspelled Persian word
    expect(menuItems()[0]).toBe(SALAM); // suggestion from the Persian dictionary
    view.destroy();
  });

  it("Add to dictionary goes to the dictionaries covering the word's script", async () => {
    const doc = `helo ${GHALAT}`;
    const view = mount(doc, ["en", "fa"]);
    await flushMicrotasks();

    rightClickAt(view, doc.length - 1);
    document.querySelectorAll<HTMLButtonElement>(".spellcheck-menu-action")[1].click(); // Add
    expect(spellers.get("fa")?.add).toHaveBeenCalledWith(GHALAT);
    expect(spellers.get("en")?.add).not.toHaveBeenCalled();
    view.destroy();
  });

  it("does not flag a word another same-script dictionary accepts", async () => {
    const view = mount("helo world", ["en", "xx"]);
    await flushMicrotasks();

    // "xx" accepts "helo", so with both enabled it is not flagged at all.
    rightClickAt(view, 2);
    expect(document.querySelector(".spellcheck-menu")).toBeNull();
    view.destroy();
  });

  it("merges and dedupes suggestions when all covering dictionaries reject", async () => {
    spellers.set("xx", makeSpeller([], { helo: ["hell", "halo"] }));
    const view = mount("helo world", ["en", "xx"]);
    await flushMicrotasks();

    rightClickAt(view, 2);
    // en offers [hello, hell], xx offers [hell, halo]; merged keeps first-seen order.
    expect(suggestionItems()).toEqual(["hello", "hell", "halo"]);
    view.destroy();
  });

  it("caps merged suggestions at seven", async () => {
    spellers.set("en", makeSpeller([], { helo: ["a", "b", "c", "d", "e"] }));
    spellers.set("xx", makeSpeller([], { helo: ["f", "g", "h", "i"] }));
    const view = mount("helo", ["en", "xx"]);
    await flushMicrotasks();

    rightClickAt(view, 2);
    expect(suggestionItems()).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
    view.destroy();
  });

  it("applies the picked suggestion", async () => {
    const view = mount("helo world", ["en"]);
    await flushMicrotasks();

    rightClickAt(view, 2);
    document.querySelectorAll<HTMLButtonElement>(".spellcheck-menu-item")[0].click();
    expect(view.state.doc.toString()).toBe("hello world");
    view.destroy();
  });

  it("ignored words stay ignored across editors and language sets", async () => {
    const first = mount("helo world", ["en"]);
    await flushMicrotasks();
    rightClickAt(first, 2);
    document.querySelectorAll<HTMLButtonElement>(".spellcheck-menu-action")[0].click(); // Ignore
    first.destroy();

    const second = mount("helo world", ["en", "fa"]);
    await flushMicrotasks();
    rightClickAt(second, 2);
    expect(document.querySelector(".spellcheck-menu")).toBeNull();
    second.destroy();
  });

  it("rescans after the document changes", async () => {
    const view = mount("world", ["en"]);
    await flushMicrotasks();
    rightClickAt(view, 2);
    expect(document.querySelector(".spellcheck-menu")).toBeNull();

    view.dispatch({ changes: { from: 5, insert: " helo" } });
    await new Promise((resolve) => setTimeout(resolve, 350)); // past the scan debounce
    rightClickAt(view, 8); // inside the new "helo"
    expect(document.querySelector(".spellcheck-menu")).not.toBeNull();
    view.destroy();
  });

  it("flags words for a loaded language while another is still loading", async () => {
    const doc = `helo ${GHALAT}`;
    const view = mount(doc, ["en", "pending"]);
    await flushMicrotasks();

    rightClickAt(view, 2); // "helo" flagged by the loaded English dictionary
    expect(document.querySelector(".spellcheck-menu")).not.toBeNull();
    view.destroy();
  });

  it("ignores a right-click that is not over any text", async () => {
    const view = mount("helo world", ["en"]);
    await flushMicrotasks();
    vi.spyOn(view, "posAtCoords").mockReturnValue(null);
    view.contentDOM.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }),
    );
    expect(document.querySelector(".spellcheck-menu")).toBeNull();
    view.destroy();
  });

  it("marks nothing when no language is enabled", async () => {
    const view = mount("helo world", []);
    await flushMicrotasks();
    rightClickAt(view, 2);
    expect(document.querySelector(".spellcheck-menu")).toBeNull();
    view.destroy();
  });

  it("a dictionary resolving after its configuration was replaced does not paint", async () => {
    let releaseSlow!: (speller: FakeSpeller) => void;
    const slow = new Promise<FakeSpeller>((resolve) => {
      releaseSlow = resolve;
    });
    getSpeller.mockImplementation((language: string) => {
      if (language === "slow") return slow;
      const speller = spellers.get(language);
      return speller ? Promise.resolve(speller) : new Promise<FakeSpeller>(() => {});
    });

    const compartment = new Compartment();
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: "helo world",
        extensions: [
          markdown({ base: markdownLanguage }),
          compartment.of(buildSpellcheck(["slow"], labels)),
        ],
      }),
      parent,
    });
    await flushMicrotasks();

    // Switch to English while the slow dictionary is still loading, then let
    // it resolve with a speller that would flag "world".
    view.dispatch({ effects: compartment.reconfigure(buildSpellcheck(["en"], labels)) });
    await flushMicrotasks();
    releaseSlow(makeSpeller([], { world: ["word"] }));
    await flushMicrotasks();

    rightClickAt(view, 7); // inside "world", correct per the live English dictionary
    expect(document.querySelector(".spellcheck-menu")).toBeNull();
    view.destroy();
  });

  it("a menu action issued after the configuration is torn down is a no-op", async () => {
    const view = mount("helo world", ["en"]);
    await flushMicrotasks();
    rightClickAt(view, 2);
    expect(document.querySelector(".spellcheck-menu")).not.toBeNull();

    // The menu outlives the editor teardown; its Ignore must not repaint.
    view.destroy();
    document.querySelectorAll<HTMLButtonElement>(".spellcheck-menu-action")[0].click();
    expect(document.querySelector(".spellcheck-menu")).toBeNull();
  });

  it("a right-click on a stale mark right after a language-set change is a no-op", async () => {
    const compartment = new Compartment();
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: "helo world",
        extensions: [
          markdown({ base: markdownLanguage }),
          compartment.of(buildSpellcheck(["en"], labels)),
        ],
      }),
      parent,
    });
    await flushMicrotasks(); // "helo" is now marked by the English dictionary

    // Reconfigure to a set whose dictionary never resolves. The old marks are
    // still painted, but the fresh plugin instance has no loaded dictionaries
    // yet, so the context menu must not open against a stale checker.
    view.dispatch({ effects: compartment.reconfigure(buildSpellcheck(["pending"], labels)) });
    rightClickAt(view, 2);
    expect(document.querySelector(".spellcheck-menu")).toBeNull();
    view.destroy();
  });
});
