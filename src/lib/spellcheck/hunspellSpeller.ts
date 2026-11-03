export interface Speller {
  correct(word: string): boolean;
  suggest(word: string): string[];
  add(word: string): void;
  dispose(): void;
}

// The text arrives decoded and the engine reads it back as UTF-8, so the affix
// file's own SET line, or Hunspell's ISO-8859-1 default when it has none, would
// misread every non-ASCII letter.
function declareUtf8(aff: string): string {
  const withoutSet = aff.replace(/^﻿/, "").replace(/^SET\b.*$/gm, "");
  return `SET UTF-8\n${withoutSet}`;
}

// Every dictionary shares one WASM heap, so an unused one must be disposed. A
// disposed speller stays callable (accepts every word, suggests nothing), so a
// suggestion menu still open on a replaced dictionary cannot throw.
export async function createHunspellSpeller(aff: string, dic: string): Promise<Speller> {
  const { createHunspellFromStrings } = await import("hunspell-wasm");
  const hunspell = await createHunspellFromStrings(declareUtf8(aff), dic);
  return {
    correct: (word) => hunspell.isDisposed || hunspell.testSpelling(word),
    suggest: (word) => (hunspell.isDisposed ? [] : hunspell.getSpellingSuggestions(word)),
    add: (word) => {
      if (!hunspell.isDisposed) hunspell.addWord(word);
    },
    dispose: () => hunspell.dispose(),
  };
}
