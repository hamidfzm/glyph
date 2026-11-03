import type { Disposer } from "@/lib/plugins/disposer";

/** Hunspell dictionary sources, resolved lazily when the language is used. */
export interface DictionarySources {
  aff: string;
  dic: string;
}

/** A spell-check dictionary contributed for one language (usually by a plugin). */
export interface DictionaryContribution {
  /** Language code stored in the editor setting, e.g. "fa". */
  language: string;
  /** Label shown in the Settings language picker, e.g. "فارسی (Persian)". */
  label: string;
  /** Produce the dictionary text; called only once the language is selected. */
  load: () => Promise<DictionarySources>;
  /**
   * ISO 15924 script codes this dictionary covers (e.g. `["Arab"]`); words in
   * other scripts are never checked against it. Defaults to the language
   * code's likely script (see `scriptsForLanguage`), so most dictionaries can
   * omit it.
   */
  scripts?: readonly string[];
}

// Module-level so the speller (plain module) and the settings UI (React) read
// the same registry without threading it through props or context. Each
// language keeps a stack: the latest registration wins, and disposing it
// brings back the one before (a community "en" over the bundled English).
const sources = new Map<string, DictionaryContribution[]>();
const listeners = new Set<(language: string) => void>();
let snapshot: readonly DictionaryContribution[] = [];

function notify(language: string): void {
  snapshot = [...sources.values()].map((stack) => stack[stack.length - 1]);
  for (const listener of listeners) listener(language);
}

/**
 * Add a dictionary for a language; the returned disposer removes it. Every
 * change to the registration a language resolves to notifies subscribers, so
 * the speller cache and the language picker stay current across plugin
 * load/unload/update.
 */
export function registerDictionarySource(contribution: DictionaryContribution): Disposer {
  const { language } = contribution;
  const stack = sources.get(language) ?? [];
  stack.push(contribution);
  sources.set(language, stack);
  notify(language);
  return () => {
    const index = stack.indexOf(contribution);
    if (index === -1) return;
    const wasActive = index === stack.length - 1;
    stack.splice(index, 1);
    if (stack.length === 0) sources.delete(language);
    if (wasActive) notify(language);
  };
}

export function getDictionarySource(language: string): DictionaryContribution | undefined {
  return sources.get(language)?.at(-1);
}

/**
 * Current contributions in registration order. The same array reference is
 * returned until the registry changes, so it is safe as a
 * `useSyncExternalStore` snapshot.
 */
export function listDictionarySources(): readonly DictionaryContribution[] {
  return snapshot;
}

/** Observe changes; listeners receive the affected language code. */
export function subscribeDictionarySources(listener: (language: string) => void): Disposer {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Test seam: reset to a pristine registry between tests.
export function clearDictionarySources(): void {
  sources.clear();
  snapshot = [];
}
