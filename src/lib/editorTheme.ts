import { HighlightStyle } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

// How the markdown editor looks: the syntax-highlight classes (styled by
// app.css so they follow the platform theme) and the CodeMirror theme that maps
// the editor chrome onto the app's custom properties.

export const glyphHighlight = HighlightStyle.define([
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

export const glyphEditorTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "var(--glyph-font-size, 16px)",
    fontFamily: "var(--glyph-code-font, 'SF Mono', 'Fira Code', 'Cascadia Code', monospace)",
    backgroundColor: "var(--color-surface)",
    color: "var(--color-text-primary)",
  },
  ".cm-scroller": { overflow: "auto" },
  ".cm-content": {
    padding: "24px 32px",
    maxWidth: "var(--glyph-content-width, 800px)",
    margin: "0 auto",
    // Honour the configured line height, which the preview already reads.
    lineHeight: "var(--glyph-line-height, 1.7)",
    caretColor: "var(--color-text-primary)",
  },
  ".cm-gutters": {
    // Must match `.cm-content`: gutters otherwise inherit CodeMirror's base 1.4
    // and each line number floats above the line it belongs to.
    lineHeight: "var(--glyph-line-height, 1.7)",
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
    backgroundColor: "color-mix(in srgb, var(--color-accent) 20%, transparent) !important",
  },
  "&.cm-focused .cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--color-accent) 25%, transparent) !important",
  },
});
