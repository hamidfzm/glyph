import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./settings";
import {
  CONTENT_WIDTH_MAP,
  FONT_FAMILY_MAP,
  LINE_HEIGHT_MAP,
  MODEL_SUGGESTIONS,
  resolveReadingFont,
} from "./settingsDisplay";

describe("FONT_FAMILY_MAP", () => {
  it("has system as empty string", () => {
    expect(FONT_FAMILY_MAP.system).toBe("");
  });

  it("has serif font stack", () => {
    expect(FONT_FAMILY_MAP.serif).toContain("Iowan Old Style");
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

describe("reading face", () => {
  // The default is per platform, so the guard is coverage rather than equality:
  // a platform without its own face silently falls back to the generic serif.
  const css = readFileSync("src/styles/platform.css", "utf8");

  it("declares a reading face for every platform the app targets", () => {
    for (const platform of ["macos", "windows", "linux", "ios", "android"]) {
      const block = css.slice(css.indexOf(`[data-platform="${platform}"]`));
      const decl = block.slice(0, block.indexOf("}")).includes("--glyph-reading-font");
      expect(decl, `${platform} has no --glyph-reading-font`).toBe(true);
    }
  });

  it("keeps a generic fallback for an unknown platform", () => {
    const root = css.slice(css.indexOf(":root"), css.indexOf("}"));
    expect(root).toContain("--glyph-reading-font");
  });
});
describe("resolveReadingFont", () => {
  const base = DEFAULT_SETTINGS.appearance;

  it("is empty for the default, so the app.css serif applies", () => {
    expect(resolveReadingFont(base)).toBe("");
  });

  it("resolves a named family to its stack", () => {
    expect(resolveReadingFont({ ...base, fontFamily: "mono" })).toContain("monospace");
  });

  it("uses the custom font when one is named", () => {
    expect(resolveReadingFont({ ...base, fontFamily: "custom", customFont: "Comic Sans MS" })).toBe(
      "Comic Sans MS",
    );
  });

  it("is empty for custom with no font named, rather than stranding the old face", () => {
    expect(resolveReadingFont({ ...base, fontFamily: "custom", customFont: "" })).toBe("");
  });

  it("is empty for a custom font that is only whitespace", () => {
    expect(resolveReadingFont({ ...base, fontFamily: "custom", customFont: "   " })).toBe("");
  });

  it("is empty for a family the map doesn't know, e.g. a hand-edited store", () => {
    const corrupt = { ...base, fontFamily: "papyrus" } as unknown as typeof base;
    expect(resolveReadingFont(corrupt)).toBe("");
  });
});
