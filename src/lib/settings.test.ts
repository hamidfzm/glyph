import { describe, expect, it } from "vitest";
import {
  CONTENT_WIDTH_MAP,
  DEFAULT_SETTINGS,
  FONT_FAMILY_MAP,
  LINE_HEIGHT_MAP,
  MODEL_SUGGESTIONS,
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
    expect(DEFAULT_SETTINGS.layout.sidebarVisible).toBe(true);
    expect(DEFAULT_SETTINGS.layout.sidebarPosition).toBe("left");
    expect(DEFAULT_SETTINGS.layout.sidebarWidth).toBe(224);
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

describe("FONT_FAMILY_MAP", () => {
  it("has system as empty string", () => {
    expect(FONT_FAMILY_MAP.system).toBe("");
  });

  it("has serif font stack", () => {
    expect(FONT_FAMILY_MAP.serif).toContain("Georgia");
  });

  it("has sans font stack", () => {
    expect(FONT_FAMILY_MAP.sans).toContain("sans-serif");
  });

  it("has mono font stack", () => {
    expect(FONT_FAMILY_MAP.mono).toContain("monospace");
  });
});

describe("LINE_HEIGHT_MAP", () => {
  it("maps compact to 1.5", () => {
    expect(LINE_HEIGHT_MAP.compact).toBe("1.5");
  });

  it("maps normal to 1.7", () => {
    expect(LINE_HEIGHT_MAP.normal).toBe("1.7");
  });

  it("maps relaxed to 2.0", () => {
    expect(LINE_HEIGHT_MAP.relaxed).toBe("2.0");
  });
});

describe("CONTENT_WIDTH_MAP", () => {
  it("maps narrow to 640px", () => {
    expect(CONTENT_WIDTH_MAP.narrow).toBe("640px");
  });

  it("maps medium to 800px", () => {
    expect(CONTENT_WIDTH_MAP.medium).toBe("800px");
  });

  it("maps wide to 1024px", () => {
    expect(CONTENT_WIDTH_MAP.wide).toBe("1024px");
  });

  it("maps full to 100%", () => {
    expect(CONTENT_WIDTH_MAP.full).toBe("100%");
  });
});

describe("MODEL_SUGGESTIONS", () => {
  it("has claude models", () => {
    expect(MODEL_SUGGESTIONS.claude).toBeInstanceOf(Array);
    expect(MODEL_SUGGESTIONS.claude.length).toBeGreaterThan(0);
  });

  it("has openai models", () => {
    expect(MODEL_SUGGESTIONS.openai).toBeInstanceOf(Array);
    expect(MODEL_SUGGESTIONS.openai).toContain("gpt-4o");
  });

  it("has ollama models", () => {
    expect(MODEL_SUGGESTIONS.ollama).toBeInstanceOf(Array);
    expect(MODEL_SUGGESTIONS.ollama.length).toBeGreaterThan(0);
  });
});
