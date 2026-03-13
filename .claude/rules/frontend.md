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
