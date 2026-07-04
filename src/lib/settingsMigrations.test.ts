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
});
