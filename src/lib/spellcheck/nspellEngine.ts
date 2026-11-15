import nspell from "nspell";
import type { SpellcheckEngine } from "./spellcheckEngines";

// The built-in engine, used until a plugin registers another. It reads the
// common Hunspell rules but not compounding, so a dictionary that builds words
// from parts (German) needs an engine plugin.
export const nspellEngine: SpellcheckEngine = {
  create: async (aff, dic) => nspell(aff, dic),
};
