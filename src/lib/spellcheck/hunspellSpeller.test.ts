import { getWasmModule } from "hunspell-wasm";
import { describe, expect, it } from "vitest";
import { createHunspellSpeller } from "./hunspellSpeller";

// A tiny dictionary exercising what German dictionaries rely on: compound
// begin/middle/end parts, a part valid only inside a compound, a suffix allowed
// inside a compound, and a homonym whose plain entry must survive a
// compound-only twin.
const AFF = [
  "SET UTF-8",
  "TRY esianrtolcdugmphbyfvkwqxz",
  "COMPOUNDBEGIN B",
  "COMPOUNDMIDDLE M",
  "COMPOUNDEND E",
  "ONLYINCOMPOUND O",
  "COMPOUNDPERMITFLAG P",
  "COMPOUNDMIN 1",
  "SFX S Y 1",
  "SFX S 0 s/P .",
  "SFX D Y 1",
  "SFX D 0 ed .",
].join("\n");
const DIC = [
  "7",
  "sun/BE",
  "flower/E",
  "field/ME",
  "stone/BO",
  "walk/E",
  "walk/BO",
  "work/BSD",
].join("\n");

describe("createHunspellSpeller", () => {
  it("accepts compounds built from begin, middle and end parts", async () => {
    const speller = await createHunspellSpeller(AFF, DIC);
    expect(speller.correct("sunflower")).toBe(true);
    expect(speller.correct("sunfieldflower")).toBe(true);
    // "flower" may only end a compound.
    expect(speller.correct("flowersun")).toBe(false);
    speller.dispose();
  });

  it("flags a compound-only part on its own but accepts it inside a compound", async () => {
    const speller = await createHunspellSpeller(AFF, DIC);
    expect(speller.correct("stone")).toBe(false);
    expect(speller.correct("stoneflower")).toBe(true);
    speller.dispose();
  });

  it("keeps a homonym's plain entry valid next to its compound-only twin", async () => {
    const speller = await createHunspellSpeller(AFF, DIC);
    expect(speller.correct("walk")).toBe(true);
    expect(speller.correct("walkflower")).toBe(true);
    speller.dispose();
  });

  it("allows inside a compound only the suffixes that permit it", async () => {
    const speller = await createHunspellSpeller(AFF, DIC);
    expect(speller.correct("worksflower")).toBe(true);
    expect(speller.correct("worked")).toBe(true);
    expect(speller.correct("workedflower")).toBe(false);
    speller.dispose();
  });

  it("suggests the correction for a misspelling", async () => {
    const speller = await createHunspellSpeller(AFF, DIC);
    expect(speller.suggest("flowr")).toContain("flower");
    speller.dispose();
  });

  it("accepts a word once it is added", async () => {
    const speller = await createHunspellSpeller(AFF, DIC);
    expect(speller.correct("glyph")).toBe(false);
    speller.add("glyph");
    expect(speller.correct("glyph")).toBe(true);
    speller.dispose();
  });

  it("is inert after dispose: accepts everything, suggests nothing, ignores adds", async () => {
    const speller = await createHunspellSpeller(AFF, DIC);
    speller.dispose();
    expect(speller.correct("zzzz")).toBe(true);
    expect(speller.suggest("flowr")).toEqual([]);
    expect(() => speller.add("glyph")).not.toThrow();
    expect(() => speller.dispose()).not.toThrow();
  });

  it("reads the text as given whatever encoding the affix file declares", async () => {
    for (const aff of ["", "SET ISO8859-1\nTRY eéc", "\uFEFFSET ISO8859-15\n"]) {
      const speller = await createHunspellSpeller(aff, "2\nécole\nfiancé\n");
      // Capitalizing and suggesting both read the characters, not just bytes.
      expect(speller.correct("École"), JSON.stringify(aff)).toBe(true);
      expect(speller.suggest("fiance"), JSON.stringify(aff)).toContain("fiancé");
      speller.dispose();
    }
  });

  it("sizes a dictionary by its words, not by the count it claims", async () => {
    // Taken at its word, this count would hold the shared heap at 2 GB.
    const speller = await createHunspellSpeller("", "536000000\nword\n");
    expect(speller.correct("word")).toBe(true);
    speller.dispose();
    const { HEAPU8 } = await getWasmModule();
    expect(HEAPU8.length).toBeLessThan(64 * 1024 * 1024);

    const next = await createHunspellSpeller(AFF, DIC);
    expect(next.correct("sunflower")).toBe(true);
    next.dispose();
  });

  it("survives malformed dictionaries without breaking the next one", async () => {
    const malformed: [string, string][] = [
      ["", ""],
      ["\u0000\uffff\ud800", "not a count\n\u0000"],
      ["", "999999999\nword\n"],
      ["FLAG num\n", "2\nword/99999999\nother/0,70000,-5\n"],
      ["AF 2\nAF A\nAF B\n", "2\nword/7\nother/-1\n"],
      ["COMPOUNDRULE 1\nCOMPOUNDRULE (((((\n", "1\na/(\n"],
      ["PFX A Y 999999\n", "1\nword/A\n"],
    ];
    for (const [aff, dic] of malformed) {
      const broken = await createHunspellSpeller(aff, dic);
      broken.suggest("word");
      broken.dispose();
    }
    const speller = await createHunspellSpeller(AFF, DIC);
    expect(speller.correct("sunflower")).toBe(true);
    expect(speller.correct("flowersun")).toBe(false);
    speller.dispose();
  });
});
