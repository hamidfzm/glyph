import { describe, expect, it } from "vitest";
import {
  AI_PANEL_WIDTH_DEFAULT,
  AI_PANEL_WIDTH_MIN,
  DEFAULT_SETTINGS,
  EDITOR_MODE,
  effectiveEditorMode,
  nextEditorMode,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
} from "./settings";

describe("DEFAULT_SETTINGS", () => {
  it("has appearance defaults", () => {
    expect(DEFAULT_SETTINGS.appearance.theme).toBe("system");
    expect(DEFAULT_SETTINGS.appearance.fontFamily).toBe("system");
    expect(DEFAULT_SETTINGS.appearance.fontSize).toBe(16);
    expect(DEFAULT_SETTINGS.appearance.lineHeight).toBe("normal");
    expect(DEFAULT_SETTINGS.appearance.contentWidth).toBe("medium");
    expect(DEFAULT_SETTINGS.appearance.codeTheme).toBe("glyph");
    expect(DEFAULT_SETTINGS.appearance.customFont).toBe("");
    expect(DEFAULT_SETTINGS.appearance.codeFont).toBe("");
  });

  it("has layout defaults", () => {
    expect(DEFAULT_SETTINGS.layout.filesSidebarVisible).toBe(true);
    expect(DEFAULT_SETTINGS.layout.outlineSidebarVisible).toBe(true);
    expect(DEFAULT_SETTINGS.layout.sidebarLayout).toBe("beside");
    expect(DEFAULT_SETTINGS.layout.swapSidebarSides).toBe(false);
    expect(DEFAULT_SETTINGS.layout.filesSidebarWidth).toBe(SIDEBAR_WIDTH_DEFAULT);
    expect(DEFAULT_SETTINGS.layout.outlineSidebarWidth).toBe(SIDEBAR_WIDTH_DEFAULT);
    expect(DEFAULT_SETTINGS.layout.aiPanelWidth).toBe(AI_PANEL_WIDTH_DEFAULT);
    expect(DEFAULT_SETTINGS.layout.backlinksHeight).toBeNull();
    expect(DEFAULT_SETTINGS.layout.tagsHeight).toBeNull();
    expect(DEFAULT_SETTINGS.layout.backlinksCollapsed).toBe(false);
    expect(DEFAULT_SETTINGS.layout.tagsCollapsed).toBe(false);
  });

  it("keeps resize bounds ordered around the defaults", () => {
    expect(SIDEBAR_WIDTH_MIN).toBeLessThan(SIDEBAR_WIDTH_DEFAULT);
    expect(SIDEBAR_WIDTH_DEFAULT).toBeLessThan(SIDEBAR_WIDTH_MAX);
    expect(AI_PANEL_WIDTH_MIN).toBeLessThan(AI_PANEL_WIDTH_DEFAULT);
  });

  it("has behavior defaults", () => {
    expect(DEFAULT_SETTINGS.behavior.autoReload).toBe(true);
    expect(DEFAULT_SETTINGS.behavior.reopenLastFile).toBe(false);
    expect(DEFAULT_SETTINGS.behavior.confirmExternalLinks).toBe(true);
    expect(DEFAULT_SETTINGS.behavior.recentFiles).toEqual([]);
  });

  it("has AI defaults", () => {
    expect(DEFAULT_SETTINGS.ai.provider).toBe("none");
    expect(DEFAULT_SETTINGS.ai.apiKeys).toEqual({});
    expect(DEFAULT_SETTINGS.ai.ollamaUrl).toBe("http://localhost:11434");
    expect(DEFAULT_SETTINGS.ai.model).toBe("");
    expect(DEFAULT_SETTINGS.ai.ttsSpeed).toBe(1.0);
  });
});

describe("nextEditorMode", () => {
  it("cycles view → edit → split → view", () => {
    expect(nextEditorMode(EDITOR_MODE.view)).toBe(EDITOR_MODE.edit);
    expect(nextEditorMode(EDITOR_MODE.edit)).toBe(EDITOR_MODE.split);
    expect(nextEditorMode(EDITOR_MODE.split)).toBe(EDITOR_MODE.view);
  });

  it("treats an undefined current mode as view (cycles to edit)", () => {
    expect(nextEditorMode(undefined)).toBe(EDITOR_MODE.edit);
  });

  it("skips split on a narrow viewport (view → edit → view)", () => {
    expect(nextEditorMode(EDITOR_MODE.view, false)).toBe(EDITOR_MODE.edit);
    expect(nextEditorMode(EDITOR_MODE.edit, false)).toBe(EDITOR_MODE.view);
    // A tab already stored as split advances to edit, not back into split.
    expect(nextEditorMode(EDITOR_MODE.split, false)).toBe(EDITOR_MODE.edit);
  });
});

describe("effectiveEditorMode", () => {
  it("collapses split to view when the viewport is too narrow to split", () => {
    expect(effectiveEditorMode(EDITOR_MODE.split, false)).toBe(EDITOR_MODE.view);
  });

  it("leaves the stored mode untouched when split fits or the mode isn't split", () => {
    expect(effectiveEditorMode(EDITOR_MODE.split, true)).toBe(EDITOR_MODE.split);
    expect(effectiveEditorMode(EDITOR_MODE.edit, false)).toBe(EDITOR_MODE.edit);
    expect(effectiveEditorMode(EDITOR_MODE.view, false)).toBe(EDITOR_MODE.view);
  });
});
