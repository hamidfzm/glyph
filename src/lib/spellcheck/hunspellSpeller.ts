import type * as HunspellWasm from "hunspell-wasm";

export interface Speller {
  correct(word: string): boolean;
  suggest(word: string): string[];
  add(word: string): void;
  dispose(): void;
}

let engine: Promise<typeof HunspellWasm> | undefined;

// hunspell-wasm caches its module only once it has compiled, so dictionaries
// loading at once would each compile their own; share one load, and drop it if
// it fails so the next dictionary retries.
function loadEngine(): Promise<typeof HunspellWasm> {
  if (!engine) {
    const loading = import("hunspell-wasm").then(async (lib) => {
      await lib.getWasmModule();
      return lib;
    });
    loading.catch(() => {
      engine = undefined;
    });
    engine = loading;
  }
  return engine;
}

// The text arrives decoded and the engine reads it back as UTF-8, so the affix
// file's own SET line, or Hunspell's ISO-8859-1 default when it has none, would
// misread every non-ASCII letter.
function declareUtf8(aff: string): string {
  const withoutSet = aff.replace(/^\uFEFF/, "").replace(/^SET\b.*$/gm, "");
  return `SET UTF-8\n${withoutSet}`;
}

// Hunspell sizes its word table from the .dic's first line before it reads a
// word, so a few bytes claiming 500 million words would hold the shared heap at
// its 2 GB ceiling for the session. Count the lines that are there instead.
function countWords(dic: string): string {
  const newline = dic.indexOf("\n");
  const words = newline === -1 ? "" : dic.slice(newline + 1);
  return `${words.split("\n").length}\n${words}`;
}

// Every dictionary shares the engine's one WASM heap, so an unused one must be
// disposed. A disposed speller stays callable (accepts every word, suggests
// nothing), so a suggestion menu still open on a replaced dictionary cannot throw.
export async function createHunspellSpeller(aff: string, dic: string): Promise<Speller> {
  const { createHunspellFromStrings } = await loadEngine();
  const hunspell = await createHunspellFromStrings(declareUtf8(aff), countWords(dic));
  return {
    correct: (word) => hunspell.isDisposed || hunspell.testSpelling(word),
    suggest: (word) => (hunspell.isDisposed ? [] : hunspell.getSpellingSuggestions(word)),
    add: (word) => {
      if (!hunspell.isDisposed) hunspell.addWord(word);
    },
    dispose: () => hunspell.dispose(),
  };
}
