import { describe, expect, it } from "vitest";
import { BUILTIN_SITE_THEMES, DEFAULT_SITE_THEME_ID, resolveSiteTheme } from "./themes";

describe("builtin site themes", () => {
  it("defaults to the github theme, which styles the whole chrome", () => {
    const github = resolveSiteTheme(DEFAULT_SITE_THEME_ID);
    expect(github.id).toBe("github");
    expect(github.css).toContain(".glyph-site-header");
    expect(github.css).toContain('.glyph-site-nav a[aria-current="page"]');
    expect(github.css).toContain('content: "On this page"');
    // Themed colors ride the app variables with light fallbacks.
    expect(github.css).toContain("var(--color-accent, #0969da)");
  });

  it("keeps the pre-theme look available as plain", () => {
    expect(resolveSiteTheme("plain").css).toBe("");
  });
});

describe("resolveSiteTheme", () => {
  const pluginTheme = { id: "solarized", label: "Solarized", css: "body { background: #fdf6e3; }" };

  it("finds plugin-contributed themes by id", () => {
    expect(resolveSiteTheme("solarized", [pluginTheme])).toBe(pluginTheme);
  });

  it("does not let a plugin hijack a builtin id", () => {
    const impostor = { id: "github", label: "Impostor", css: "body { visibility: hidden; }" };
    expect(resolveSiteTheme("github", [impostor]).label).toBe("GitHub");
  });

  it("fails loudly on unknown ids, listing what exists", () => {
    expect(() => resolveSiteTheme("neon", [pluginTheme])).toThrow(
      /Unknown site theme "neon"\. Available themes: github, plain, solarized/,
    );
  });

  it("ships exactly the documented builtins", () => {
    expect(BUILTIN_SITE_THEMES.map((t) => t.id)).toEqual(["github", "plain"]);
  });
});
