import { describe, expect, it } from "vitest";
import { ClaudeProvider } from "./ai/claude";
import { OllamaProvider } from "./ai/ollama";
import { OpenAIProvider } from "./ai/openai";
import { createAIProvider } from "./ai-providers";
import type { AISettings } from "./settings";

describe("createAIProvider", () => {
  const baseSettings: AISettings = {
    provider: "none",
    apiKeys: {},
    ollamaUrl: "http://localhost:11434",
    model: "test-model",
    ttsVoice: "",
    ttsSpeed: 1.0,
  };

  it("returns null for none provider", () => {
    expect(createAIProvider({ ...baseSettings, provider: "none" })).toBeNull();
  });

  it("returns null for unknown provider", () => {
    expect(
      createAIProvider({ ...baseSettings, provider: "unknown" as AISettings["provider"] }),
    ).toBeNull();
  });

  it("returns ClaudeProvider with API key", () => {
    const provider = createAIProvider({
      ...baseSettings,
      provider: "claude",
      apiKeys: { claude: "test-key" },
    });
    expect(provider).toBeInstanceOf(ClaudeProvider);
  });

  it("returns null for claude without API key", () => {
    expect(createAIProvider({ ...baseSettings, provider: "claude" })).toBeNull();
  });

  it("returns OpenAIProvider with API key", () => {
    const provider = createAIProvider({
      ...baseSettings,
      provider: "openai",
      apiKeys: { openai: "test-key" },
    });
    expect(provider).toBeInstanceOf(OpenAIProvider);
  });

  it("returns null for openai without API key", () => {
    expect(createAIProvider({ ...baseSettings, provider: "openai" })).toBeNull();
  });

  it("returns OllamaProvider (no key required)", () => {
    expect(createAIProvider({ ...baseSettings, provider: "ollama" })).toBeInstanceOf(
      OllamaProvider,
    );
  });

  it("uses default ollama URL when empty", () => {
    expect(createAIProvider({ ...baseSettings, provider: "ollama", ollamaUrl: "" })).toBeInstanceOf(
      OllamaProvider,
    );
  });
});
