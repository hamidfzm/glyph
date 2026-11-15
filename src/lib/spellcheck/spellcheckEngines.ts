import type { Disposer } from "@/lib/plugins/disposer";

/** One dictionary, loaded by a spell-check engine. */
export interface SpellChecker {
  correct(word: string): boolean;
  suggest(word: string): string[];
  /** Accept a word for the rest of the session ("Add to Dictionary"). */
  add(word: string): void;
  /** Free the dictionary once it is replaced or removed, or its engine is. */
  dispose?(): void;
}

/** Builds a checker from a dictionary's Hunspell `.aff`/`.dic` text. */
export interface SpellcheckEngine {
  create(aff: string, dic: string): Promise<SpellChecker>;
}

// The latest registration wins, and disposing it brings back the one before;
// with none registered the speller uses its built-in engine.
const engines: SpellcheckEngine[] = [];
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Replace the engine every dictionary is checked with; the disposer restores the previous one. */
export function registerSpellcheckEngine(engine: SpellcheckEngine): Disposer {
  engines.push(engine);
  notify();
  return () => {
    const index = engines.indexOf(engine);
    if (index === -1) return;
    const wasActive = index === engines.length - 1;
    engines.splice(index, 1);
    if (wasActive) notify();
  };
}

export function getSpellcheckEngine(): SpellcheckEngine | undefined {
  return engines.at(-1);
}

/** Observe a change of the active engine. */
export function subscribeSpellcheckEngine(listener: () => void): Disposer {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Test seam: reset to no registered engine between tests.
export function clearSpellcheckEngines(): void {
  engines.length = 0;
}
