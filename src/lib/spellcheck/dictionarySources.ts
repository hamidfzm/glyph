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
}

// Module-level so the speller (plain module) and the settings UI (React) read
// the same registry without threading it through props or context. Keyed by
// language: a later registration for the same code replaces the earlier one.
const sources = new Map<string, DictionaryContribution>();
const listeners = new Set<(language: string) => void>();
let snapshot: readonly DictionaryContribution[] = [];

function notify(language: string): void {
  snapshot = [...sources.values()];
  for (const listener of listeners) listener(language);
}

/**
 * Add a dictionary for a language; the returned disposer removes it. Both the
 * registration and its disposal notify subscribers, so the speller cache and
 * the language picker stay current across plugin load/unload/update.
 */
export function registerDictionarySource(contribution: DictionaryContribution): Disposer {
  sources.set(contribution.language, contribution);
  notify(contribution.language);
  return () => {
    if (sources.get(contribution.language) === contribution) {
      sources.delete(contribution.language);
      notify(contribution.language);
    }
  };
}

export function getDictionarySource(language: string): DictionaryContribution | undefined {
  return sources.get(language);
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
