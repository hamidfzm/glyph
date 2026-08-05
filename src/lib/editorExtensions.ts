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
import type { Compartment, Extension } from "@codemirror/state";
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
  onDocChange: (doc: string) => void;
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
  onDocChange,
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
      if (update.docChanged) {
        onDocChange(update.state.doc.toString());
      }
    }),
    glyphEditorTheme,
  ];
}
