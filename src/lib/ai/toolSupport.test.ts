import { describe, expect, it } from "vitest";
import {
  assistantToolsOn,
  rememberToolsRefused,
  toolsOffered,
  toolsRefusedByModel,
} from "@/lib/ai/toolSupport";
import { type AISettings, ASSISTANT_TOOLS_DEFAULT, DEFAULT_SETTINGS } from "@/lib/settings";

const ai = (overrides: Partial<AISettings>): AISettings => ({
  ...DEFAULT_SETTINGS.ai,
  ...overrides,
});
const allOn = { claude: true, openai: true, ollama: true };

describe("toolsOffered", () => {
  it("follows the switch for the current provider", () => {
    const on = { claude: true, openai: false, ollama: false };
    expect(toolsOffered(ai({ provider: "claude", assistantTools: on }))).toBe(true);
    expect(toolsOffered(ai({ provider: "openai", assistantTools: on }))).toBe(false);
    expect(toolsOffered(ai({ provider: "none", assistantTools: allOn }))).toBe(false);
  });

  it("stops offering tools to an Ollama model that refused them, and only to it", () => {
    const refusing = ai({ provider: "ollama", model: "gemma:2b", assistantTools: allOn });
    const other = ai({ provider: "ollama", model: "qwen3", assistantTools: allOn });
    const elsewhere = { ...refusing, ollamaUrl: "http://lan-host:11434" };
    expect(toolsOffered(refusing)).toBe(true);

    rememberToolsRefused(refusing);

    expect(toolsOffered(refusing)).toBe(false);
    expect(toolsOffered(other)).toBe(true);
    expect(toolsOffered(elsewhere)).toBe(true);
  });
});

describe("toolsRefusedByModel", () => {
  it("is true only while the user wants the tools from an Ollama model that refused them", () => {
    const wanted = ai({ provider: "ollama", model: "tinyllama", assistantTools: allOn });
    expect(toolsRefusedByModel(wanted)).toBe(false);
    rememberToolsRefused(wanted);
    expect(toolsRefusedByModel(wanted)).toBe(true);
    const switchedOff = { ...wanted, assistantTools: { ...allOn, ollama: false } };
    expect(toolsRefusedByModel(switchedOff)).toBe(false);
    expect(toolsRefusedByModel({ ...wanted, provider: "openai" })).toBe(false);
  });
});

describe("assistantToolsOn", () => {
  it("follows the default until the user chooses", () => {
    const unset = ai({ assistantTools: { claude: null, openai: null, ollama: null } });
    for (const provider of ["claude", "openai", "ollama"] as const) {
      expect(assistantToolsOn(unset, provider)).toBe(ASSISTANT_TOOLS_DEFAULT[provider]);
    }
    const chosen = { claude: null, openai: null, ollama: false };
    expect(assistantToolsOn(ai({ assistantTools: chosen }), "ollama")).toBe(false);
  });

  it("falls back to the default for a value a hand-edited file left", () => {
    for (const assistantTools of [null, "on", 1, { claude: "yes" }]) {
      const odd = ai({ assistantTools: assistantTools as unknown as AISettings["assistantTools"] });
      expect(assistantToolsOn(odd, "claude")).toBe(ASSISTANT_TOOLS_DEFAULT.claude);
    }
  });
});
