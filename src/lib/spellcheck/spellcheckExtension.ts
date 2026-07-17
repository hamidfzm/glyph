import { type Extension, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin } from "@codemirror/view";
import { getDictionarySource } from "./dictionarySources";
import { scriptCoverage, scriptsForLanguage } from "./scripts";
import { getSpeller, type Speller } from "./speller";
import { mergedSuggestions, openSuggestionMenu, type SuggestionMenuLabels } from "./suggestionMenu";
import { scanWords } from "./wordScanner";

// Rescan is debounced by this much after edits/scroll so typing stays smooth.
const SCAN_DEBOUNCE_MS = 300;

const setMisspellings = StateEffect.define<DecorationSet>();

const misspellingField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    const mapped = value.map(tr.changes);
    const update = tr.effects.find((effect) => effect.is(setMisspellings));
    return update ? update.value : mapped;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const misspelledMark = Decoration.mark({ class: "cm-misspelled" });

/** One enabled dictionary, reduced to what the underline pass needs. */
export interface Checker {
  covers(word: string): boolean;
  correct(word: string): boolean;
}

// Build the underline decorations for the given ranges. A word is checked only
// against the checkers covering its script: covered by none means skipped (so
// mixed-language text is not flagged wholesale), and it is marked only when
// every covering checker rejects it. Exported for tests.
export function buildMisspellings(
  state: EditorView["state"],
  ranges: readonly { from: number; to: number }[],
  checkers: readonly Checker[],
  ignored: ReadonlySet<string>,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of ranges) {
    for (const token of scanWords(state, range.from, range.to)) {
      if (ignored.has(token.word.toLowerCase())) continue;
      const covering = checkers.filter((checker) => checker.covers(token.word));
      if (covering.length === 0) continue;
      if (covering.some((checker) => checker.correct(token.word))) continue;
      builder.add(token.from, token.to, misspelledMark);
    }
  }
  return builder.finish();
}

// Words the user chose to ignore, kept for the session so toggling languages
// or spell check off/on does not resurrect them. Not persisted to disk.
const ignoredWords = new Set<string>();

// Test seam: reset the session ignore list between tests.
export function clearIgnoredWords(): void {
  ignoredWords.clear();
}

// A contribution may declare its script coverage; otherwise infer it from the
// language code.
function coverageFor(language: string): (word: string) => boolean {
  return scriptCoverage(getDictionarySource(language)?.scripts ?? scriptsForLanguage(language));
}

interface LoadedDictionary extends Checker {
  speller: Speller;
}

class SpellcheckPlugin {
  loaded: LoadedDictionary[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private destroyed = false;

  constructor(view: EditorView, languages: readonly string[]) {
    // Clear leftovers from a previous configuration even if nothing loads
    // (e.g. every language was disabled); each arriving dictionary then
    // repaints progressively without waiting for the slowest one.
    this.schedule(view, 0);
    for (const language of languages) {
      getSpeller(language)
        .then((speller) => {
          // A load resolving after this configuration was replaced must not
          // paint stale marks onto the live view.
          if (this.destroyed) return;
          this.loaded.push({
            covers: coverageFor(language),
            correct: (word) => speller.correct(word),
            speller,
          });
          this.rescan(view);
        })
        .catch(() => {});
    }
  }

  update(update: { docChanged: boolean; viewportChanged: boolean; view: EditorView }): void {
    if (update.docChanged || update.viewportChanged) {
      this.schedule(update.view, SCAN_DEBOUNCE_MS);
    }
  }

  private schedule(view: EditorView, delay: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.rescan(view), delay);
  }

  checkersFor(word: string): LoadedDictionary[] {
    return this.loaded.filter((dictionary) => dictionary.covers(word));
  }

  rescan(view: EditorView): void {
    if (this.destroyed) return;
    const decorations = buildMisspellings(
      view.state,
      view.visibleRanges,
      this.loaded,
      ignoredWords,
    );
    view.dispatch({ effects: setMisspellings.of(decorations) });
  }

  destroy(): void {
    this.destroyed = true;
    clearTimeout(this.timer);
  }
}

function misspelledWordAt(
  view: EditorView,
  pos: number,
): { from: number; to: number; text: string } | null {
  // The field is installed alongside this handler by buildSpellcheck, so it is
  // always present when a context-menu event reaches here.
  const field = view.state.field(misspellingField);
  let found: { from: number; to: number; text: string } | null = null;
  field.between(pos, pos, (from, to) => {
    found = { from, to, text: view.state.doc.sliceString(from, to) };
    return false;
  });
  return found;
}

// Enable spell checking for a set of languages. Wrapped in a Compartment by
// the editor so changing the set reconfigures in place without recreating the
// view.
export function buildSpellcheck(
  languages: readonly string[],
  getLabels: () => SuggestionMenuLabels,
): Extension {
  const plugin = ViewPlugin.define((view) => new SpellcheckPlugin(view, languages));

  const contextMenu = EditorView.domEventHandlers({
    contextmenu(event, view) {
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos == null) return false;

      const word = misspelledWordAt(view, pos);
      if (!word) return false;

      // The plugin is installed with this handler, so the instance is always
      // present; a marked word implies at least one covering dictionary.
      const instance = view.plugin(plugin) as SpellcheckPlugin;
      const covering = instance.checkersFor(word.text);
      if (covering.length === 0) return false;

      event.preventDefault();
      openSuggestionMenu({
        x: event.clientX,
        y: event.clientY,
        suggestions: mergedSuggestions(
          covering.map((dictionary) => dictionary.speller),
          word.text,
        ),
        labels: getLabels(),
        onPick: (replacement) => {
          view.dispatch({ changes: { from: word.from, to: word.to, insert: replacement } });
        },
        onIgnore: () => {
          ignoredWords.add(word.text.toLowerCase());
          instance.rescan(view);
        },
        onAdd: () => {
          for (const dictionary of covering) dictionary.speller.add(word.text);
          instance.rescan(view);
        },
      });
      return true;
    },
  });

  return [misspellingField, plugin, contextMenu];
}
