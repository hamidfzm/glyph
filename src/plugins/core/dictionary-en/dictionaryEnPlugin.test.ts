import nspell from "nspell";
import { describe, expect, it, vi } from "vitest";
import type { DictionaryContribution, GlyphPluginContext } from "@/lib/plugins/types";
import plugin from "./dictionaryEnPlugin";

async function registered(): Promise<DictionaryContribution> {
  const registerDictionary = vi.fn();
  await plugin.activate({ spellcheck: { registerDictionary } } as unknown as GlyphPluginContext);
  expect(registerDictionary).toHaveBeenCalledTimes(1);
  return registerDictionary.mock.calls[0][0];
}

describe("English dictionary core plugin", () => {
  it("registers US English for the Latin script", async () => {
    const dictionary = await registered();
    expect(dictionary.language).toBe("en");
    expect(dictionary.label).toBe("English (US)");
    expect(dictionary.scripts).toBeUndefined();
  });

  it("loads its bundled UTF-8 Hunspell files", async () => {
    const { aff, dic } = await (await registered()).load();
    expect(aff.startsWith("SET UTF-8")).toBe(true);
    expect(Number(dic.split("\n", 1)[0])).toBeGreaterThan(40_000);
  });

  // The words pass, the misspellings are caught, and each is offered its
  // correction, with the engine the app checks with until a plugin brings another.
  it("checks and corrects English with the built-in engine", async () => {
    const { aff, dic } = await (await registered()).load();
    const checker = nspell(aff, dic);
    const correct = ["the", "receive", "color", "children", "doesn't", "Wednesday", "it's"];
    for (const word of correct) expect(checker.correct(word), word).toBe(true);
    const corrections = { recieve: "receive", teh: "the", wrold: "world", seperate: "separate" };
    for (const [typo, fix] of Object.entries(corrections)) {
      expect(checker.correct(typo), typo).toBe(false);
      expect(checker.suggest(typo), typo).toContain(fix);
    }
  });
});
