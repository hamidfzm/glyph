import { describe, expect, it } from "vitest";
import { FALLBACK_LOCALE, localeDir, resolveLocale } from "./locales";

describe("resolveLocale", () => {
  it("matches a supported code exactly, case-insensitively", () => {
    expect(resolveLocale("en")).toBe("en");
    expect(resolveLocale("EN")).toBe("en");
    expect(resolveLocale("fa")).toBe("fa");
    expect(resolveLocale("es")).toBe("es");
    expect(resolveLocale("de")).toBe("de");
    expect(resolveLocale("zh")).toBe("zh");
  });

  it("falls back from a regional/script tag to its primary subtag", () => {
    expect(resolveLocale("en-US")).toBe("en");
    expect(resolveLocale("fa-IR")).toBe("fa");
    expect(resolveLocale("de-AT")).toBe("de");
    expect(resolveLocale("es-MX")).toBe("es");
    expect(resolveLocale("zh-Hans")).toBe("zh");
    expect(resolveLocale("zh-CN")).toBe("zh");
  });

  it("falls back to English for unsupported and empty inputs", () => {
    expect(resolveLocale("fr-FR")).toBe(FALLBACK_LOCALE);
    expect(resolveLocale("ja")).toBe(FALLBACK_LOCALE);
    expect(resolveLocale(null)).toBe(FALLBACK_LOCALE);
    expect(resolveLocale(undefined)).toBe(FALLBACK_LOCALE);
    expect(resolveLocale("")).toBe(FALLBACK_LOCALE);
  });
});

describe("localeDir", () => {
  it("returns the direction of a supported locale", () => {
    expect(localeDir("en")).toBe("ltr");
    expect(localeDir("fa")).toBe("rtl");
    expect(localeDir("de")).toBe("ltr");
    expect(localeDir("zh")).toBe("ltr");
  });

  it("defaults to ltr for unknown codes", () => {
    expect(localeDir("xx")).toBe("ltr");
  });
});
