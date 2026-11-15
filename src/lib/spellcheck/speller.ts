import { getDictionarySource, subscribeDictionarySources } from "./dictionarySources";
import { nspellEngine } from "./nspellEngine";
import {
  getSpellcheckEngine,
  type SpellChecker,
  subscribeSpellcheckEngine,
} from "./spellcheckEngines";

/** A loaded dictionary as the editor holds it. */
export interface Speller extends SpellChecker {
  dispose(): void;
}

// Plugins supply the dictionary text, so it is refused before parsing past this
// many characters. The largest official dictionary (Persian) is 1.7 million.
const MAX_DICTIONARY_LENGTH = 32_000_000;

// One shared promise per language: a dictionary is parsed once and every editor
// reuses it. Added words mutate that instance, so all open editors see them
// (session-scoped, in memory).
const cache = new Map<string, Promise<Speller>>();

// Words added this session, per language, so a dictionary rebuilt for a new
// source or engine still accepts them.
const addedWords = new Map<string, Set<string>>();

// A plugin failing to hand over its text may succeed next time (an asset read),
// so only this failure is retried; a missing, refused or unparseable dictionary
// fails the same way until its source or the engine changes.
class DictionaryReadError extends Error {}

function isChecker(value: unknown): value is SpellChecker {
  const candidate = value as Partial<SpellChecker> | null | undefined;
  return (
    typeof candidate?.correct === "function" &&
    typeof candidate.suggest === "function" &&
    typeof candidate.add === "function"
  );
}

function wordsAddedTo(language: string): Set<string> {
  let words = addedWords.get(language);
  if (!words) {
    words = new Set();
    addedWords.set(language, words);
  }
  return words;
}

// An engine is plugin code, so a checker that throws is freed and from then on
// accepts every word and suggests nothing, as a replaced one does while a
// suggestion menu is still open on it: one broken engine cannot stop the editor
// checking the other languages.
function guarded(language: string, checker: SpellChecker): Speller {
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    try {
      checker.dispose?.();
    } catch (error) {
      console.error(`The "${language}" spell checker failed to free its dictionary:`, error);
    }
  };
  const call = <T>(fallback: T, run: () => T): T => {
    if (disposed) return fallback;
    try {
      return run();
    } catch (error) {
      console.error(`The "${language}" spell checker failed and stopped checking:`, error);
      dispose();
      return fallback;
    }
  };
  return {
    correct: (word) => call(true, () => checker.correct(word) === true),
    suggest: (word) =>
      call([], () => checker.suggest(word).filter((suggestion) => typeof suggestion === "string")),
    add: (word) => {
      wordsAddedTo(language).add(word);
      call(undefined, () => checker.add(word));
    },
    dispose,
  };
}

async function loadSpeller(language: string): Promise<Speller> {
  const source = getDictionarySource(language);
  if (!source) throw new Error(`no dictionary is registered for "${language}"`);
  const { aff, dic } = await source.load().catch((error: unknown) => {
    throw new DictionaryReadError(`the "${language}" dictionary could not be read`, {
      cause: error,
    });
  });
  // A sandboxed plugin's result crosses a worker boundary unchecked.
  if (typeof aff !== "string" || typeof dic !== "string") {
    throw new Error(`the "${language}" dictionary is not text`);
  }
  if (aff.length + dic.length > MAX_DICTIONARY_LENGTH) {
    throw new Error(`the "${language}" dictionary is over the size limit`);
  }
  const engine = getSpellcheckEngine() ?? nspellEngine;
  const checker: unknown = await engine.create(aff, dic);
  if (!isChecker(checker)) {
    throw new Error(`the spell-check engine built no checker for "${language}"`);
  }
  const speller = guarded(language, checker);
  for (const word of addedWords.get(language) ?? []) speller.add(word);
  return speller;
}

// Drop a language's cached checker, and free it once any pending load settles.
function evict(language: string): void {
  const pending = cache.get(language);
  if (!pending) return;
  cache.delete(language);
  pending.then(
    (speller) => speller.dispose(),
    () => {},
  );
}

// A new, replaced or removed source makes its language's checker stale, and a
// new engine makes every checker stale. These subscriptions are registered
// before any editor's, so an editor reloading on the same notification already
// gets a fresh load.
subscribeDictionarySources(evict);
subscribeSpellcheckEngine(() => {
  for (const language of [...cache.keys()]) evict(language);
});

export function getSpeller(language: string): Promise<Speller> {
  let pending = cache.get(language);
  if (!pending) {
    pending = loadSpeller(language);
    // Any other failure stays cached, so it is logged once, and the listeners
    // above drop it when a new source or engine arrives.
    pending.catch((error) => {
      console.error(`The "${language}" spell-check dictionary failed to load:`, error);
      const retryable = error instanceof DictionaryReadError;
      if (retryable && cache.get(language) === pending) cache.delete(language);
    });
    cache.set(language, pending);
  }
  return pending;
}

// Test seam: drop cached spellers and added words so a fresh load runs next time.
export function clearSpellerCache(): void {
  cache.clear();
  addedWords.clear();
}
