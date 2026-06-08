// Shared Tailwind class strings for the themed in-app context menu, kept in one
// module so the menu surface and its buttons stay visually in sync.

// The menu surface (root panel and submenu panels): themed with the app's own
// fonts and CSS color variables so it matches the UI instead of the OS menu.
export const SURFACE_CLASS =
  "fixed z-50 min-w-[12rem] p-1 rounded-[var(--glyph-radius)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[0_10px_30px_rgba(0,0,0,0.22)] text-[13px] text-[var(--color-text-primary)] select-none";

// A single menu row (action button or submenu trigger).
export const ITEM_CLASS =
  "flex w-full items-center justify-between gap-6 rounded-[var(--glyph-radius-sm)] px-2.5 py-1.5 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--color-accent)_16%,transparent)] focus:bg-[color-mix(in_srgb,var(--color-accent)_16%,transparent)] focus:outline-none";
