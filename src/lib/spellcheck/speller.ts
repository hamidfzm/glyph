import { getDictionarySource, subscribeDictionarySources } from "./dictionarySources";
import { createHunspellSpeller, type Speller } from "./hunspellSpeller";

export type { Speller };

// Plugins supply the dictionary text, so it is refused before parsing past this
// many characters. The largest official dictionary (Persian) is 1.7 million.
const MAX_DICTIONARY_LENGTH = 32_000_000;

// One shared promise per language: a dictionary is parsed once and every editor
// reuses it. Added words mutate that instance, so all open editors see them
// (session-scoped, in memory).
const cache = new Map<string, Promise<Speller>>();

// A plugin failing to hand over its text may succeed next time (an asset read),
// so only this failure is retried; a missing, refused or unparseable dictionary
// fails the same way until its source changes.
class DictionaryReadError extends Error {}

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
  return createHunspellSpeller(aff, dic);
}

// When a language's source is registered, replaced or removed, its cached
// checker is stale: drop it, and free it once any pending load settles. This
// subscription is registered before any editor's, so an editor reloading on the
// same notification already gets a fresh load.
subscribeDictionarySources((language) => {
  const pending = cache.get(language);
  if (!pending) return;
  cache.delete(language);
  pending.then(
    (speller) => speller.dispose(),
    () => {},
  );
});

export function getSpeller(language: string): Promise<Speller> {
  let pending = cache.get(language);
  if (!pending) {
    pending = loadSpeller(language);
    // Any other failure stays cached, so it is logged once, and the registry
    // listener above drops it when a new source arrives.
    pending.catch((error) => {
      console.error(`The "${language}" spell-check dictionary failed to load:`, error);
      const retryable = error instanceof DictionaryReadError;
      if (retryable && cache.get(language) === pending) cache.delete(language);
    });
    cache.set(language, pending);
  }
  return pending;
}

// Test seam: drop cached spellers so a fresh load runs next time.
export function clearSpellerCache(): void {
  cache.clear();
}
