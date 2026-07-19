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

  it("applies the sidebar and spell-check migrations together", () => {
    const migrated = migrateLegacySettings({
      layout: { sidebarWidth: 200 },
      editor: { spellCheckLanguage: "en" },
    });
    expect(migrated.layout).toEqual({ filesSidebarWidth: 200, outlineSidebarWidth: 200 });
    expect(migrated.editor).toEqual({ spellCheckLanguages: ["en"] });
  });
});
