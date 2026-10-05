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

/**
 * Math moved from the Markdown settings into a core plugin. Carry an explicit
 * `markdown.math: false` over to `corePlugins.math` (unless the store already
 * has that key) and drop the old key.
 */
function migrateMathToCorePlugin(saved: Record<string, unknown>): Record<string, unknown> {
  const markdown = saved.markdown;
  if (!isSafePlainObject(markdown) || !("math" in markdown)) return saved;
  const { math, ...rest } = markdown;
  const corePlugins = isSafePlainObject(saved.corePlugins) ? saved.corePlugins : {};
  if (math !== false || "math" in corePlugins) return { ...saved, markdown: rest };
  return { ...saved, markdown: rest, corePlugins: { ...corePlugins, math: false } };
}

const LEGACY_FILES_BLOCKS = [
  {
    key: "glyph.core.backlinks:backlinks",
    height: "backlinksHeight",
    collapsed: "backlinksCollapsed",
  },
  { key: "glyph.core.tags:tags", height: "tagsHeight", collapsed: "tagsCollapsed" },
];

/**
 * Backlinks and tags moved into core plugins, whose Files panel blocks keep
 * their layout in `layout.blocks`. Carry the four legacy keys over (unless the
 * store already has the block) and drop them.
 */
function migrateFilesBlocks(saved: Record<string, unknown>): Record<string, unknown> {
  const layout = saved.layout;
  if (!isSafePlainObject(layout)) return saved;
  const legacy = LEGACY_FILES_BLOCKS.filter(
    (block) => block.height in layout || block.collapsed in layout,
  );
  // The consumers index into the map, so a corrupt store value is discarded
  // here (the default then applies) rather than crashing the Files panel.
  const corrupt = "blocks" in layout && !isSafePlainObject(layout.blocks);
  if (legacy.length === 0 && !corrupt) return saved;

  const rest = { ...layout };
  const blocks = isSafePlainObject(rest.blocks) ? { ...rest.blocks } : {};
  for (const block of legacy) {
    const height = rest[block.height];
    if (!(block.key in blocks)) {
      blocks[block.key] = {
        height: typeof height === "number" ? height : null,
        collapsed: rest[block.collapsed] === true,
      };
    }
    delete rest[block.height];
    delete rest[block.collapsed];
  }
  return { ...saved, layout: { ...rest, blocks } };
}

export function migrateLegacySettings(saved: Record<string, unknown>): Record<string, unknown> {
  return migrateFilesBlocks(
    migrateMathToCorePlugin(migrateSpellCheckLanguages(migrateSidebarWidth(saved))),
  );
}
