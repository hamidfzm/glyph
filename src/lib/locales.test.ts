import { describe, expect, it } from "vitest";
import { FALLBACK_LOCALE, localeDir, resolveLocale } from "./locales";

describe("resolveLocale", () => {
  it("matches a supported code exactly, case-insensitively", () => {
    expect(resolveLocale("en")).toBe("en");
    expect(resolveLocale("EN")).toBe("en");
  });

  it("falls back from a regional tag to its primary subtag", () => {
    expect(resolveLocale("en-US")).toBe("en");
    expect(resolveLocale("en-GB")).toBe("en");
  });

  it("falls back to English for unsupported and empty inputs", () => {
    expect(resolveLocale("de")).toBe(FALLBACK_LOCALE);
    expect(resolveLocale("fr-FR")).toBe(FALLBACK_LOCALE);
    expect(resolveLocale("zh-Hans")).toBe(FALLBACK_LOCALE);
    expect(resolveLocale(null)).toBe(FALLBACK_LOCALE);
    expect(resolveLocale(undefined)).toBe(FALLBACK_LOCALE);
    expect(resolveLocale("")).toBe(FALLBACK_LOCALE);
  });
});

describe("localeDir", () => {
  it("returns the direction of a supported locale", () => {
    expect(localeDir("en")).toBe("ltr");
  });

  it("defaults to ltr for unknown codes", () => {
    expect(localeDir("xx")).toBe("ltr");
  });
});
