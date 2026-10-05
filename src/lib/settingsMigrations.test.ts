import { describe, expect, it } from "vitest";
import { migrateLegacySettings } from "./settingsMigrations";

describe("migrateLegacySettings", () => {
  it("copies a legacy sidebarWidth to both new keys and drops it", () => {
    const migrated = migrateLegacySettings({
      layout: { sidebarWidth: 256, swapSidebarSides: true },
    });
    expect(migrated.layout).toEqual({
      swapSidebarSides: true,
      filesSidebarWidth: 256,
      outlineSidebarWidth: 256,
    });
  });

  it("does not overwrite new keys that already exist", () => {
    const migrated = migrateLegacySettings({
      layout: { sidebarWidth: 256, filesSidebarWidth: 300 },
    });
    expect(migrated.layout).toEqual({
      filesSidebarWidth: 300,
      outlineSidebarWidth: 256,
    });
  });

  it("seeds the files width while preserving an existing outline width", () => {
    const migrated = migrateLegacySettings({
      layout: { sidebarWidth: 256, outlineSidebarWidth: 300 },
    });
    expect(migrated.layout).toEqual({
      filesSidebarWidth: 256,
      outlineSidebarWidth: 300,
    });
  });

  it("passes already-migrated settings through unchanged", () => {
    const saved = { layout: { filesSidebarWidth: 300, outlineSidebarWidth: 224 } };
    expect(migrateLegacySettings(saved)).toBe(saved);
  });

  it("passes settings without a layout section through unchanged", () => {
    const saved = { appearance: { theme: "dark" } };
    expect(migrateLegacySettings(saved)).toBe(saved);
  });

  it("ignores a non-numeric legacy value", () => {
    const saved = { layout: { sidebarWidth: "wide" } };
    expect(migrateLegacySettings(saved)).toBe(saved);
  });

  it("preserves unrelated top-level sections", () => {
    const migrated = migrateLegacySettings({
      appearance: { theme: "dark" },
      layout: { sidebarWidth: 200 },
    });
    expect(migrated.appearance).toEqual({ theme: "dark" });
  });

  it("seeds spellCheckLanguages from the legacy single language and drops it", () => {
    const migrated = migrateLegacySettings({
      editor: { keymap: "vim", spellCheckLanguage: "fa" },
    });
    expect(migrated.editor).toEqual({ keymap: "vim", spellCheckLanguages: ["fa"] });
  });

  it("does not overwrite an existing spellCheckLanguages array", () => {
    const migrated = migrateLegacySettings({
      editor: { spellCheckLanguage: "fa", spellCheckLanguages: ["en", "de"] },
    });
    expect(migrated.editor).toEqual({ spellCheckLanguages: ["en", "de"] });
  });

  it("passes an editor section without the legacy key through unchanged", () => {
    const saved = { editor: { spellCheckLanguages: ["en"] } };
    expect(migrateLegacySettings(saved)).toBe(saved);
  });

  it("drops a blank legacy language without seeding the array", () => {
    const migrated = migrateLegacySettings({ editor: { spellCheckLanguage: "" } });
    expect(migrated.editor).toEqual({});
  });

  it("discards a corrupt non-array spellCheckLanguages so the default applies", () => {
    const migrated = migrateLegacySettings({ editor: { spellCheckLanguages: "en" } });
    expect(migrated.editor).toEqual({});
  });

  it("repairs a corrupt value from the legacy key when both are present", () => {
    const migrated = migrateLegacySettings({
      editor: { spellCheckLanguage: "de", spellCheckLanguages: "en" },
    });
    expect(migrated.editor).toEqual({ spellCheckLanguages: ["de"] });
  });

  it("moves math off from the Markdown settings to the core plugin toggle", () => {
    const migrated = migrateLegacySettings({ markdown: { gfm: true, math: false } });
    expect(migrated.markdown).toEqual({ gfm: true });
    expect(migrated.corePlugins).toEqual({ math: false });
  });

  it("drops math on without touching the core plugins, so the default applies", () => {
    const migrated = migrateLegacySettings({
      markdown: { math: true },
      corePlugins: { d2: false },
    });
    expect(migrated.markdown).toEqual({});
    expect(migrated.corePlugins).toEqual({ d2: false });
  });

  it("keeps a core plugin math choice the store already has", () => {
    const migrated = migrateLegacySettings({
      markdown: { math: false },
      corePlugins: { math: true },
    });
    expect(migrated.corePlugins).toEqual({ math: true });
    expect(migrateLegacySettings(migrated)).toEqual(migrated);
  });

  it("leaves a store without the legacy math key unchanged", () => {
    const saved = { markdown: { gfm: false } };
    expect(migrateLegacySettings(saved)).toBe(saved);
  });

  it("moves the backlinks and tags layout into the Files panel blocks", () => {
    const migrated = migrateLegacySettings({
      layout: {
        filesSidebarVisible: true,
        backlinksHeight: 150,
        backlinksCollapsed: false,
        tagsHeight: null,
        tagsCollapsed: true,
      },
    });
    expect(migrated.layout).toEqual({
      filesSidebarVisible: true,
      blocks: {
        "glyph.core.backlinks:backlinks": { height: 150, collapsed: false },
        "glyph.core.tags:tags": { height: null, collapsed: true },
      },
    });
    expect(migrateLegacySettings(migrated)).toBe(migrated);
  });

  it("migrates only the block whose legacy keys are present", () => {
    const migrated = migrateLegacySettings({ layout: { tagsCollapsed: true } });
    expect(migrated.layout).toEqual({
      blocks: { "glyph.core.tags:tags": { height: null, collapsed: true } },
    });
  });

  it("keeps a block layout the store already has, and still drops the legacy keys", () => {
    const saved = { height: 90, collapsed: true };
    const migrated = migrateLegacySettings({
      layout: { backlinksHeight: 300, blocks: { "glyph.core.backlinks:backlinks": saved } },
    });
    expect(migrated.layout).toEqual({ blocks: { "glyph.core.backlinks:backlinks": saved } });
  });

  it("discards a legacy block layout of the wrong type instead of carrying it over", () => {
    const migrated = migrateLegacySettings({
      layout: { backlinksHeight: "tall", backlinksCollapsed: "yes", blocks: "corrupt" },
    });
    expect(migrated.layout).toEqual({
      blocks: { "glyph.core.backlinks:backlinks": { height: null, collapsed: false } },
    });
  });

  // The Files panel indexes into the map, so a hand-edited null would crash it.
  it.each([null, "corrupt", ["a"], 3])("drops a blocks value of %j", (blocks) => {
    const migrated = migrateLegacySettings({ layout: { filesSidebarVisible: false, blocks } });
    expect(migrated.layout).toEqual({ filesSidebarVisible: false, blocks: {} });
    expect(migrateLegacySettings(migrated)).toBe(migrated);
  });

  it("leaves a layout without the legacy block keys unchanged", () => {
    const saved = { layout: { filesSidebarVisible: false, blocks: {} } };
    expect(migrateLegacySettings(saved)).toBe(saved);
  });

  it("applies the sidebar and spell-check migrations together", () => {
    const migrated = migrateLegacySettings({
      layout: { sidebarWidth: 200 },
      editor: { spellCheckLanguage: "en" },
    });
    expect(migrated.layout).toEqual({ filesSidebarWidth: 200, outlineSidebarWidth: 200 });
    expect(migrated.editor).toEqual({ spellCheckLanguages: ["en"] });
  });
});
