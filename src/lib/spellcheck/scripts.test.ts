import { afterEach, describe, expect, it, vi } from "vitest";
import { scriptCoverage, scriptsForLanguage } from "./scripts";

const ZWNJ = "\u200C";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("scriptsForLanguage", () => {
  it("resolves language codes through likely-subtags data", () => {
    expect(scriptsForLanguage("fa")).toEqual(["Arab"]);
    expect(scriptsForLanguage("en")).toEqual(["Latn"]);
    expect(scriptsForLanguage("ru")).toEqual(["Cyrl"]);
    expect(scriptsForLanguage("bn")).toEqual(["Beng"]);
    expect(scriptsForLanguage("hy")).toEqual(["Armn"]);
    expect(scriptsForLanguage("ja")).toEqual(["Jpan"]);
  });

  it("accepts POSIX-style underscore codes as Hunspell names them", () => {
    expect(scriptsForLanguage("fa_IR")).toEqual(["Arab"]);
    expect(scriptsForLanguage("pt_BR")).toEqual(["Latn"]);
  });

  it("uses the primary subtag of a regioned code", () => {
    expect(scriptsForLanguage("fa-IR")).toEqual(["Arab"]);
    expect(scriptsForLanguage("pt-BR")).toEqual(["Latn"]);
  });

  it("defaults unresolvable codes to Latn", () => {
    expect(scriptsForLanguage("xx")).toEqual(["Latn"]);
    expect(scriptsForLanguage("")).toEqual(["Latn"]);
  });
});

describe("scriptCoverage", () => {
  it("matches words by their leading letter's script", () => {
    const arabic = scriptCoverage(["Arab"]);
    expect(arabic(`می${ZWNJ}روم`)).toBe(true);
    expect(arabic("hello")).toBe(false);

    const latin = scriptCoverage(["Latn"]);
    expect(latin("hello")).toBe(true);
    expect(latin("привет")).toBe(false);
  });

  it("covers every script Unicode knows, not a fixed list", () => {
    expect(scriptCoverage(["Beng"])("বাংলা")).toBe(true);
    expect(scriptCoverage(["Geor"])("ქართული")).toBe(true);
    expect(scriptCoverage(["Ethi"])("አማርኛ")).toBe(true);
    expect(scriptCoverage(["Khmr"])("ខ្មែរ")).toBe(true);
  });

  it("expands ISO 15924 composite codes wherever they appear", () => {
    // Declared directly (a plugin manifest) or inferred from a language code,
    // composites cover each constituent script.
    for (const japanese of [scriptCoverage(["Jpan"]), scriptCoverage(scriptsForLanguage("ja"))]) {
      expect(japanese("こんにちは")).toBe(true); // Hiragana
      expect(japanese("カタカナ")).toBe(true); // Katakana
      expect(japanese("漢字")).toBe(true); // Han
      expect(japanese("hello")).toBe(false);
    }
    expect(scriptCoverage(["Hans"])("你好")).toBe(true);
  });

  it("accepts any casing of a four-letter code", () => {
    expect(scriptCoverage(["arab"])(`می${ZWNJ}روم`)).toBe(true);
    expect(scriptCoverage(["LATN"])("hello")).toBe(true);
  });

  it("a crafted script name cannot break out of the probe pattern", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const coverage = scriptCoverage(["Latn}|."]);
    // A breakout would produce /^\p{Script=Latn}|./u and cover everything.
    expect(coverage("привет")).toBe(false);
    expect(coverage("hello")).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it("warns about an unknown script name and contributes no coverage from it", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const coverage = scriptCoverage(["NotAScript", "Latn"]);
    expect(coverage("hello")).toBe(true);
    expect(coverage("привет")).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("NotAScript"));
  });
});
