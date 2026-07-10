---
paths:
  - "src/**/*.{ts,tsx}"
---

# Frontend Rules

- Use `invoke` from `@tauri-apps/api/core` for Rust command calls
- Use `listen` from `@tauri-apps/api/event` for Tauri events
- Platform detection via `@tauri-apps/plugin-os`, set as CSS `data-platform` attribute
- Theme (dark/light) via `matchMedia('prefers-color-scheme: dark')`, toggle `.dark` class on `<html>`
- All color values use CSS custom properties (`var(--color-*)`) for theme support
- Platform-specific styling uses CSS custom properties (`var(--glyph-*)`) not JSX conditionals
- Naming: `onFoo` for callback props, `handleFoo` for the local function bound to one (including effect-local listeners); a ref that stores a prop keeps the prop's name (`onCommitRef`). Boolean state reads as a predicate: `isFoo`, `hasFoo`, or a UI-state noun like `settingsOpen`/`loaded`. Hooks are `useFoo` and return named objects, not tuples (single-value hooks may return the value directly).
- **Rendering changes cover every export path.** A change to how rendered markdown looks or behaves (text direction, styling, new syntax, sanitization) is only done when it also works in the HTML, EPUB, DOCX, and PDF exports (`src/lib/export/`) and print. CSS reaches HTML/EPUB automatically via `collectStyles`, but DOCX and PDF re-render from walked HTML and need explicit handling; pdfmake in particular does no bidi or complex-text shaping, so content it can't draw is captured from the live DOM as an image (the block-math precedent in `prepareContent.ts`). Also check the other `.markdown-body` consumers: AI chat replies, note embeds, notebook outputs, canvas text cards.
