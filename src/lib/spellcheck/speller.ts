import nspell from "nspell";

// A loaded spell checker instance for one language.
export type Speller = ReturnType<typeof nspell>;

// Dictionaries are served as static assets from public/dictionaries/<lang>/,
// so they stay out of the JS bundle and load only when spell check is turned
// on. The app origin serves the built dist/ root in both dev and Tauri, so an
// absolute path resolves the same in each.
const DICTIONARY_BASE = "/dictionaries";

// One shared promise per language: the ~550 KB dictionary is fetched and parsed
// once, and every editor reuses the same instance. Personal/added words mutate
// this instance, so all open editors see them (session-scoped, in memory).
const cache = new Map<string, Promise<Speller>>();

async function loadSpeller(language: string): Promise<Speller> {
  const base = `${DICTIONARY_BASE}/${language}`;
  const [aff, dic] = await Promise.all([
    fetch(`${base}/index.aff`).then((res) => res.text()),
    fetch(`${base}/index.dic`).then((res) => res.text()),
  ]);
  return nspell(aff, dic);
}

export function getSpeller(language: string): Promise<Speller> {
  let pending = cache.get(language);
  if (!pending) {
    pending = loadSpeller(language);
    cache.set(language, pending);
  }
  return pending;
}

// Test seam: drop cached spellers so a fresh load runs next time.
export function clearSpellerCache(): void {
  cache.clear();
}
