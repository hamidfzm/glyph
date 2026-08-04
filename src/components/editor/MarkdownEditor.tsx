import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useWorkspaceRoot } from "@/contexts/TabsContext";
import { usePlatform } from "@/hooks/usePlatform";
import { useSettings } from "@/hooks/useSettings";
import type { EditorMenuLabels } from "@/lib/editorContextMenu";
import { buildEditorExtensions } from "@/lib/editorExtensions";
import type { FormatBindings } from "@/lib/editorWrapSelection";
import { resolveBindings } from "@/lib/keybindings";
import { buildSpellcheck } from "@/lib/spellcheck/spellcheckExtension";
import type { SuggestionMenuLabels } from "@/lib/spellcheck/suggestionMenu";

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
  // Read at paste time through a ref, so toggling the setting applies without
  // rebuilding the editor.
  const pasteHtmlRef = useRef(settings.editor.pasteHtmlAsMarkdown);
  pasteHtmlRef.current = settings.editor.pasteHtmlAsMarkdown;

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

    const view = new EditorView({
      state: EditorState.create({
        doc: content,
        extensions: buildEditorExtensions({
          keymapPreset,
          workspaceFilesRef,
          workspaceRootRef,
          formatBindingsRef,
          formatLabelsRef,
          pasteHtmlRef,
          spellcheckCompartment,
          spellcheckExtension: spellcheckExtension(spellCheck, spellCheckLanguages),
          onDocChange: (doc: string) => onChangeRef.current(doc),
        }),
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
