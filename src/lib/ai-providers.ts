import { ClaudeProvider } from "@/lib/ai/claude";
import { OllamaProvider } from "@/lib/ai/ollama";
import { OpenAIProvider } from "@/lib/ai/openai";
import type { AIProvider } from "@/lib/ai/types";
import type { AISettings } from "./settings";

// Picks the configured backend. Each provider lives in its own module under
// `ai/`; this file is only the settings-driven choice between them.

export function createAIProvider(settings: AISettings): AIProvider | null {
  switch (settings.provider) {
    case "claude": {
      const key = settings.apiKeys.claude;
      if (!key) return null;
      return new ClaudeProvider(key, settings.model);
    }
    case "openai": {
      const key = settings.apiKeys.openai;
      if (!key) return null;
      return new OpenAIProvider(key, settings.model);
    }
    case "ollama": {
      return new OllamaProvider(settings.ollamaUrl || "http://localhost:11434", settings.model);
    }
    default:
      return null;
  }
}
