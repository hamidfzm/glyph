import { describe, expect, it } from "vitest";
import { scriptsForLanguage, wordScript } from "./scripts";

const ZWNJ = "\u200C";

describe("wordScript", () => {
  it("classifies common scripts by the leading letter", () => {
    expect(wordScript("hello")).toBe("latin");
    expect(wordScript(`می${ZWNJ}روم`)).toBe("arabic");
    expect(wordScript("привет")).toBe("cyrillic");
    expect(wordScript("γειά")).toBe("greek");
    expect(wordScript("שלום")).toBe("hebrew");
    expect(wordScript("你好")).toBe("han");
    expect(wordScript("안녕")).toBe("hangul");
    expect(wordScript("こんにちは")).toBe("kana");
    expect(wordScript("नमस्ते")).toBe("devanagari");
    expect(wordScript("สวัสดี")).toBe("thai");
  });

  it("falls back to other for unprobed scripts", () => {
    expect(wordScript("ᚠᚢᚦ")).toBe("other"); // runic
  });
});

describe("scriptsForLanguage", () => {
  it("maps known codes to their primary script", () => {
    expect(scriptsForLanguage("fa")).toEqual(["arabic"]);
    expect(scriptsForLanguage("ru")).toEqual(["cyrillic"]);
    expect(scriptsForLanguage("ja")).toEqual(["kana", "han"]);
  });

  it("uses the primary subtag of a regioned code", () => {
    expect(scriptsForLanguage("fa-IR")).toEqual(["arabic"]);
    expect(scriptsForLanguage("PT_br")).toEqual(["latin"]);
  });

  it("defaults unknown codes to latin", () => {
    expect(scriptsForLanguage("en")).toEqual(["latin"]);
    expect(scriptsForLanguage("xx")).toEqual(["latin"]);
  });
});
