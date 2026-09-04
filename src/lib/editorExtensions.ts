import {
  acceptCompletion,
  autocompletion,
  closeCompletion,
  completionKeymap,
  moveCompletionSelection,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { search, searchKeymap, searchPanelOpen } from "@codemirror/search";
import { Annotation, type Compartment, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import type { RefObject } from "react";
import { type EditorMenuLabels, editorContextMenu } from "@/lib/editorContextMenu";
import { formatToolbar } from "@/lib/editorFormatToolbar";
import { editorKeymapExtensions } from "@/lib/editorKeymap";
import { pasteHtmlExtension } from "@/lib/editorPasteHtml";
import { glyphEditorTheme, glyphHighlight } from "@/lib/editorTheme";
import {
  type FormatBindings,
  formatBindingsExtension,
  wrapSelectionExtension,
} from "@/lib/editorWrapSelection";
import type { EditorKeymap } from "@/lib/settings";
import { wikilinkCompletionSource } from "@/lib/wikilinkCompletion";

/**
 * Marks a transaction that pushes externally-owned text into the editor (a file
 * reload, or the initial buffer). Such a change is already what the caller
 * holds, so reporting it back through `onDocChange` would have the editor and
 * React state overwrite each other until React aborts the update loop.
 */
export const externalContentSync = Annotation.define<boolean>();

interface EditorExtensionOptions {
  keymapPreset: EditorKeymap;
  /** Live values the extensions read at event time, so a settings change
   *  applies without tearing the editor down. */
  workspaceFilesRef: RefObject<readonly string[]>;
  workspaceRootRef: RefObject<string | undefined>;
  formatBindingsRef: RefObject<FormatBindings>;
  formatLabelsRef: RefObject<EditorMenuLabels>;
  pasteHtmlRef: RefObject<boolean>;
  /** Holds the spell-check extension so it can be reconfigured in place. */
  spellcheckCompartment: Compartment;
  spellcheckExtension: Extension;
  /** Holds the search panel's translated labels, reconfigured on locale change. */
  searchPhrasesCompartment: Compartment;
  searchPhrases: Extension;
  onDocChange: (doc: string) => void;
  /** Fires when the panel closes from inside (Escape or its close button). */
  onSearchPanelClose: () => void;
}

/** The full extension list for a markdown editor instance, in the order the
 *  keymaps have to resolve. */
export function buildEditorExtensions({
  keymapPreset,
  workspaceFilesRef,
  workspaceRootRef,
  formatBindingsRef,
  formatLabelsRef,
  pasteHtmlRef,
  spellcheckCompartment,
  spellcheckExtension,
  searchPhrasesCompartment,
  searchPhrases,
  onDocChange,
  onSearchPanelClose,
}: EditorExtensionOptions): Extension[] {
  const { leading, extraKeys } = editorKeymapExtensions(keymapPreset);
  return [
    // Vim (when selected) installs first so its modal handler wins.
    ...leading,
    lineNumbers(),
    history(),
    // Formatting binds ahead of the keymap below: defaultKeymap claims
    // Mod-i for selectParentSyntax (with preventDefault), which would
    // otherwise swallow the italic shortcut before it is seen.
    formatBindingsExtension(() => formatBindingsRef.current),
    // Completion keymap (Tab-accept, Esc-close, arrows-navigate) goes
    // before defaultKeymap so it can claim Tab when the popup is open.
    keymap.of([
      { key: "Tab", run: acceptCompletion },
      { key: "Escape", run: closeCompletion },
      { key: "ArrowDown", run: moveCompletionSelection(true) },
      { key: "ArrowUp", run: moveCompletionSelection(false) },
      ...completionKeymap,
      // VSCode preset bindings (empty for other presets) take precedence
      // over the CodeMirror defaults below.
      ...extraKeys,
      // Ahead of defaultKeymap so Escape closes the search panel rather than
      // collapsing the selection; the rest of searchKeymap is unclaimed.
      ...searchKeymap,
      ...defaultKeymap,
      ...historyKeymap,
    ]),
    autocompletion({
      override: [
        wikilinkCompletionSource({
          workspaceFilesRef,
          workspaceRootRef,
        }),
      ],
      activateOnTyping: true,
      // Don't dismiss on transient focus changes (e.g. theme/setting
      // updates that re-render React siblings) — Esc still closes.
      closeOnBlur: false,
    }),
    // The panel adds its own replace row whenever the document is writable, so
    // find and replace need no separate UI. Phrases must precede it: they are
    // read when the panel is built.
    searchPhrasesCompartment.of(searchPhrases),
    search({ top: true }),
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    pasteHtmlExtension(() => pasteHtmlRef.current),
    wrapSelectionExtension,
    formatToolbar(() => formatLabelsRef.current),
    syntaxHighlighting(glyphHighlight),
    spellcheckCompartment.of(spellcheckExtension),
    // After spell check, so a right-click on a misspelled word still gets
    // the suggestion menu instead of this one.
    editorContextMenu(() => formatLabelsRef.current),
    EditorView.lineWrapping,
    EditorView.updateListener.of((update) => {
      const external = update.transactions.some((tr) => tr.annotation(externalContentSync));
      if (update.docChanged && !external) {
        onDocChange(update.state.doc.toString());
      }
      if (searchPanelOpen(update.startState) && !searchPanelOpen(update.state)) {
        onSearchPanelClose();
      }
    }),
    glyphEditorTheme,
  ];
}
