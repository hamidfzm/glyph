import { isSafePlainObject } from "./settingsObject";

// One-shot migrations applied to the raw persisted settings object before it
// is merged with DEFAULT_SETTINGS. Keep each migration idempotent: loading an
// already-migrated store must be a no-op.

/**
 * v0.5 split the shared `layout.sidebarWidth` into `filesSidebarWidth` and
 * `outlineSidebarWidth`. Seed both from the legacy value (unless the store
 * already has them) and drop the old key.
 */
function migrateSidebarWidth(saved: Record<string, unknown>): Record<string, unknown> {
  const layout = saved.layout;
  if (!isSafePlainObject(layout) || typeof layout.sidebarWidth !== "number") return saved;
  const { sidebarWidth, ...rest } = layout;
  if (typeof rest.filesSidebarWidth !== "number") rest.filesSidebarWidth = sidebarWidth;
  if (typeof rest.outlineSidebarWidth !== "number") rest.outlineSidebarWidth = sidebarWidth;
  return { ...saved, layout: rest };
}

/**
 * Multi-language spell check replaced the single `editor.spellCheckLanguage`
 * with the enabled-set `editor.spellCheckLanguages`. Seed the array from the
 * legacy value (unless the store already has one) and drop the old key.
 */
function migrateSpellCheckLanguages(saved: Record<string, unknown>): Record<string, unknown> {
  const editor = saved.editor;
  if (!isSafePlainObject(editor)) return saved;
  const legacy = editor.spellCheckLanguage;
  const corrupt = "spellCheckLanguages" in editor && !Array.isArray(editor.spellCheckLanguages);
  if (typeof legacy !== "string" && !corrupt) return saved;
  const { spellCheckLanguage, ...rest } = editor;
  // The consumers assume an array, so a corrupt store value is discarded here
  // (the default then applies) rather than crashing the editor on mount.
  if (corrupt) delete rest.spellCheckLanguages;
  // A blank legacy value (hand-edited store) is dropped rather than seeded, so
  // the default set applies instead of a useless [""] entry.
  if (!Array.isArray(rest.spellCheckLanguages) && typeof legacy === "string" && legacy.length > 0) {
    rest.spellCheckLanguages = [legacy];
  }
  return { ...saved, editor: rest };
}

export function migrateLegacySettings(saved: Record<string, unknown>): Record<string, unknown> {
  return migrateSpellCheckLanguages(migrateSidebarWidth(saved));
}
