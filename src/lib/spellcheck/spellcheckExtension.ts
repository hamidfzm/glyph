import { type Extension, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin } from "@codemirror/view";
import { getSpeller, type Speller } from "./speller";
import { openSuggestionMenu, type SuggestionMenuLabels } from "./suggestionMenu";
import { scanWords } from "./wordScanner";

// Rescan is debounced by this much after edits/scroll so typing stays smooth.
const SCAN_DEBOUNCE_MS = 300;
const MAX_SUGGESTIONS = 7;

const setMisspellings = StateEffect.define<DecorationSet>();

const misspellingField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setMisspellings)) value = effect.value;
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const misspelledMark = Decoration.mark({ class: "cm-misspelled" });

// Only `correct` is needed to place underlines, so tests can pass a fake.
interface Corrector {
  correct(word: string): boolean;
}

// Build the underline decorations for the given ranges. Exported for tests:
// with a fake corrector it verifies which words get marked and that code, URLs
// and frontmatter are skipped (that exclusion lives in scanWords).
export function buildMisspellings(
  state: EditorView["state"],
  ranges: readonly { from: number; to: number }[],
  corrector: Corrector,
  ignored: ReadonlySet<string>,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of ranges) {
    for (const token of scanWords(state, range.from, range.to)) {
      if (ignored.has(token.word.toLowerCase())) continue;
      if (corrector.correct(token.word)) continue;
      builder.add(token.from, token.to, misspelledMark);
    }
  }
  return builder.finish();
}

// Words the user chose to ignore, per language, kept for the session so a
// toggle off/on does not resurrect them. Not persisted to disk (see spec).
const ignoredByLanguage = new Map<string, Set<string>>();

function ignoreSetFor(language: string): Set<string> {
  let set = ignoredByLanguage.get(language);
  if (!set) {
    set = new Set();
    ignoredByLanguage.set(language, set);
  }
  return set;
}

class SpellcheckPlugin {
  speller: Speller | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    view: EditorView,
    language: string,
    private readonly ignored: ReadonlySet<string>,
  ) {
    getSpeller(language)
      .then((speller) => {
        this.speller = speller;
        this.rescan(view);
      })
      .catch(() => {});
  }

  update(update: { docChanged: boolean; viewportChanged: boolean; view: EditorView }): void {
    if (update.docChanged || update.viewportChanged) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.rescan(update.view), SCAN_DEBOUNCE_MS);
    }
  }

  rescan(view: EditorView): void {
    if (!this.speller) return;
    const decorations = buildMisspellings(
      view.state,
      view.visibleRanges,
      this.speller,
      this.ignored,
    );
    view.dispatch({ effects: setMisspellings.of(decorations) });
  }

  destroy(): void {
    clearTimeout(this.timer);
  }
}

function misspelledWordAt(
  view: EditorView,
  pos: number,
): { from: number; to: number; text: string } | null {
  const field = view.state.field(misspellingField, false);
  if (!field) return null;
  let found: { from: number; to: number; text: string } | null = null;
  field.between(pos, pos, (from, to) => {
    found = { from, to, text: view.state.doc.sliceString(from, to) };
    return false;
  });
  return found;
}

// Enable spell checking for one language. Wrapped in a Compartment by the editor
// so toggling on/off reconfigures in place without recreating the view.
export function buildSpellcheck(
  language: string,
  getLabels: () => SuggestionMenuLabels,
): Extension {
  const ignored = ignoreSetFor(language);
  const plugin = ViewPlugin.define((view) => new SpellcheckPlugin(view, language, ignored));

  const contextMenu = EditorView.domEventHandlers({
    contextmenu(event, view) {
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos == null) return false;
      const word = misspelledWordAt(view, pos);
      if (!word) return false;

      const instance = view.plugin(plugin);
      const speller = instance?.speller;
      if (!speller) return false;

      event.preventDefault();
      openSuggestionMenu({
        x: event.clientX,
        y: event.clientY,
        suggestions: speller.suggest(word.text).slice(0, MAX_SUGGESTIONS),
        labels: getLabels(),
        onPick: (replacement) => {
          view.dispatch({ changes: { from: word.from, to: word.to, insert: replacement } });
        },
        onIgnore: () => {
          ignored.add(word.text.toLowerCase());
          instance?.rescan(view);
        },
        onAdd: () => {
          speller.add(word.text);
          instance?.rescan(view);
        },
      });
      return true;
    },
  });

  return [misspellingField, plugin, contextMenu];
}
