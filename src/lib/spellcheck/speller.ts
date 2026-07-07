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

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  // fetch only rejects on network failure, so a missing/misconfigured
  // dictionary would otherwise hand nspell a 404 HTML body as if it were valid.
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return res.text();
}

async function loadSpeller(language: string): Promise<Speller> {
  const base = `${DICTIONARY_BASE}/${language}`;
  const [aff, dic] = await Promise.all([
    fetchText(`${base}/index.aff`),
    fetchText(`${base}/index.dic`),
  ]);
  return nspell(aff, dic);
}

export function getSpeller(language: string): Promise<Speller> {
  let pending = cache.get(language);
  if (!pending) {
    pending = loadSpeller(language);
    // Never cache a failed load: drop it so the next call retries instead of
    // handing back the rejected promise for the rest of the session.
    pending.catch(() => cache.delete(language));
    cache.set(language, pending);
  }
  return pending;
}

// Test seam: drop cached spellers so a fresh load runs next time.
export function clearSpellerCache(): void {
  cache.clear();
}
