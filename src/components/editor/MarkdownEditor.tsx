import {
  acceptCompletion,
  autocompletion,
  closeCompletion,
  completionKeymap,
  moveCompletionSelection,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useWorkspaceRoot } from "@/contexts/TabsContext";
import { usePlatform } from "@/hooks/usePlatform";
import { useSettings } from "@/hooks/useSettings";
import { type EditorMenuLabels, editorContextMenu } from "@/lib/editorContextMenu";
import { formatToolbar } from "@/lib/editorFormatToolbar";
import { editorKeymapExtensions } from "@/lib/editorKeymap";
import {
  type FormatBindings,
  formatBindingsExtension,
  wrapSelectionExtension,
} from "@/lib/editorWrapSelection";
import { resolveBindings } from "@/lib/keybindings";
import { buildSpellcheck } from "@/lib/spellcheck/spellcheckExtension";
import type { SuggestionMenuLabels } from "@/lib/spellcheck/suggestionMenu";
import { wikilinkCompletionSource } from "@/lib/wikilinkCompletion";

interface MarkdownEditorProps {
  content: string;
  onChange: (content: string) => void;
  workspaceFiles?: string[];
}

export function MarkdownEditor({ content, onChange, workspaceFiles }: MarkdownEditorProps) {
  const workspaceRoot = useWorkspaceRoot();
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Read workspace state through refs so the completion source — installed
  // once at mount — picks up updates without reconfiguring the editor. The
  // extension is intentionally NOT in a Compartment: directory-changed events
  // produce a new array identity every time the watcher fires, and any
  // reconfigure mid-completion would tear down the popup state.
  const workspaceFilesRef = useRef<readonly string[]>(workspaceFiles ?? []);
  const workspaceRootRef = useRef<string | undefined>(workspaceRoot);
  workspaceFilesRef.current = workspaceFiles ?? [];
  workspaceRootRef.current = workspaceRoot;

  const { t } = useTranslation("settings");
  const { settings } = useSettings();
  const platform = usePlatform();
  const keymapPreset = settings.editor.keymap;

  // Formatting accelerators are read at keydown time through this ref, so a
  // remap in Settings -> Hotkeys applies without rebuilding the editor.
  const formatBindingsRef = useRef<FormatBindings>({
    resolved: new Map(),
    platform,
  });
  formatBindingsRef.current = {
    resolved: resolveBindings(settings.keybindings.overrides),
    platform,
  };

  // Read once when the toolbar mounts; a locale change remounts the editor
  // through the same keymap-keyed effect that owns the rest of the extensions.
  const formatLabelsRef = useRef<EditorMenuLabels>({
    bold: "",
    italic: "",
    code: "",
    strikethrough: "",
    cut: "",
    copy: "",
    paste: "",
    selectAll: "",
  });
  formatLabelsRef.current = {
    bold: t("editor.format.bold"),
    italic: t("editor.format.italic"),
    code: t("editor.format.code"),
    strikethrough: t("editor.format.strikethrough"),
    cut: t("editor.format.cut"),
    copy: t("editor.format.copy"),
    paste: t("editor.format.paste"),
    selectAll: t("editor.format.selectAll"),
  };
  const { spellCheck, spellCheckLanguages } = settings.editor;
  // Settings saves produce a fresh array identity every time; key the
  // reconfigure effect on the joined value so only real set changes fire it.
  const spellCheckLanguagesKey = spellCheckLanguages.join(",");

  // Spell check lives in a Compartment so toggling it reconfigures the editor in
  // place (cursor, selection and undo history survive). Kept in a ref so the
  // same instance is reused across renders and the keymap-driven rebuild.
  const spellcheckCompartment = useRef(new Compartment()).current;

  // Context-menu labels are read at menu-open time through this ref, so a locale
  // change is reflected without reconfiguring the spell-check extension.
  const spellLabelsRef = useRef<SuggestionMenuLabels>({ ignore: "", add: "", empty: "" });
  spellLabelsRef.current = {
    ignore: t("editor.spellCheck.ignore"),
    add: t("editor.spellCheck.add"),
    empty: t("editor.spellCheck.noSuggestions"),
  };
  const spellcheckExtension = (enabled: boolean, languages: readonly string[]) =>
    enabled ? buildSpellcheck(languages, () => spellLabelsRef.current) : [];

  // biome-ignore lint/correctness/useExhaustiveDependencies: content is synced via separate effect below to avoid destroying the editor on every keystroke
  useEffect(() => {
    if (!containerRef.current) return;

    const { leading, extraKeys } = editorKeymapExtensions(keymapPreset);

    const glyphHighlight = HighlightStyle.define([
      { tag: tags.heading1, class: "cm-heading cm-heading-1" },
      { tag: tags.heading2, class: "cm-heading cm-heading-2" },
      { tag: tags.heading3, class: "cm-heading cm-heading-3" },
      { tag: [tags.heading4, tags.heading5, tags.heading6], class: "cm-heading" },
      { tag: tags.strong, class: "cm-strong" },
      { tag: tags.emphasis, class: "cm-emphasis" },
      { tag: tags.strikethrough, class: "cm-strikethrough" },
      { tag: tags.link, class: "cm-link" },
      { tag: tags.url, class: "cm-url" },
      { tag: tags.processingInstruction, class: "cm-meta" },
      { tag: tags.monospace, class: "cm-code" },
      { tag: tags.quote, class: "cm-quote" },
      { tag: [tags.meta, tags.comment], class: "cm-meta" },
      { tag: tags.keyword, class: "cm-keyword" },
      { tag: tags.string, class: "cm-string" },
      { tag: tags.number, class: "cm-number" },
    ]);

    const view = new EditorView({
      state: EditorState.create({
        doc: content,
        extensions: [
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
            { key: "ArrowDown", run: (v) => moveCompletionSelection(true)(v) },
            { key: "ArrowUp", run: (v) => moveCompletionSelection(false)(v) },
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
          wrapSelectionExtension,
          formatToolbar(() => formatLabelsRef.current),
          syntaxHighlighting(glyphHighlight),
          spellcheckCompartment.of(spellcheckExtension(spellCheck, spellCheckLanguages)),
          // After spell check, so a right-click on a misspelled word still gets
          // the suggestion menu instead of this one.
          editorContextMenu(() => formatLabelsRef.current),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
          EditorView.theme({
            "&": {
              height: "100%",
              fontSize: "var(--glyph-font-size, 16px)",
              fontFamily:
                "var(--glyph-code-font, 'SF Mono', 'Fira Code', 'Cascadia Code', monospace)",
              backgroundColor: "var(--color-surface)",
              color: "var(--color-text-primary)",
            },
            ".cm-scroller": { overflow: "auto" },
            ".cm-content": {
              padding: "24px 32px",
              maxWidth: "var(--glyph-content-width, 800px)",
              margin: "0 auto",
              caretColor: "var(--color-text-primary)",
            },
            ".cm-gutters": {
              backgroundColor: "var(--color-surface-secondary)",
              color: "var(--color-text-tertiary)",
              border: "none",
              borderRight: "1px solid var(--color-border)",
            },
            ".cm-activeLineGutter": {
              backgroundColor: "var(--color-surface-tertiary)",
            },
            ".cm-activeLine": {
              backgroundColor: "color-mix(in srgb, var(--color-accent) 5%, transparent)",
            },
            ".cm-cursor": {
              borderLeftColor: "var(--color-text-primary)",
            },
            ".cm-selectionBackground": {
              backgroundColor:
                "color-mix(in srgb, var(--color-accent) 20%, transparent) !important",
            },
            "&.cm-focused .cm-selectionBackground": {
              backgroundColor:
                "color-mix(in srgb, var(--color-accent) 25%, transparent) !important",
            },
          }),
        ],
      }),
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [keymapPreset]);

  // Sync content from outside (e.g., file reload) without losing cursor
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentDoc = view.state.doc.toString();
    if (currentDoc !== content) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: content },
      });
    }
  }, [content]);

  // Toggle spell check or change the enabled language set in place, keeping
  // editor state intact.
  // biome-ignore lint/correctness/useExhaustiveDependencies: spellcheckCompartment is a stable ref, and spellCheckLanguages is deliberately keyed by its joined value (settings saves churn the array identity)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: spellcheckCompartment.reconfigure(
        spellcheckExtension(spellCheck, spellCheckLanguages),
      ),
    });
  }, [spellCheck, spellCheckLanguagesKey]);

  return <div ref={containerRef} className="editor-container" />;
}
