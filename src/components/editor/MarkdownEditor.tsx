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
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useEffect, useRef } from "react";
import { wikilinkCompletionSource } from "../../lib/wikilinkCompletion";

interface MarkdownEditorProps {
  content: string;
  onChange: (content: string) => void;
  workspaceFiles?: string[];
  workspaceRoot?: string;
}

export function MarkdownEditor({
  content,
  onChange,
  workspaceFiles,
  workspaceRoot,
}: MarkdownEditorProps) {
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: content is synced via separate effect below to avoid destroying the editor on every keystroke
  useEffect(() => {
    if (!containerRef.current) return;

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
          lineNumbers(),
          history(),
          // Completion keymap (Tab-accept, Esc-close, arrows-navigate) goes
          // before defaultKeymap so it can claim Tab when the popup is open.
          keymap.of([
            { key: "Tab", run: acceptCompletion },
            { key: "Escape", run: closeCompletion },
            { key: "ArrowDown", run: (v) => moveCompletionSelection(true)(v) },
            { key: "ArrowUp", run: (v) => moveCompletionSelection(false)(v) },
            ...completionKeymap,
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
          }),
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          syntaxHighlighting(glyphHighlight),
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
  }, []);

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

  return <div ref={containerRef} className="editor-container" />;
}
