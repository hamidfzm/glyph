import type { AISettings } from "./settings";

export interface AIProvider {
  complete(prompt: string, systemPrompt?: string): Promise<string>;
}

export class ClaudeProvider implements AIProvider {
  constructor(
    private apiKey: string,
    private model: string,
  ) {}

  async complete(prompt: string, systemPrompt?: string): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.model || "claude-sonnet-4-20250514",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    };
    if (systemPrompt) {
      body.system = systemPrompt;
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Claude API error (${response.status}): ${err}`);
    }

    const data = await response.json();
    return data.content?.[0]?.text ?? "";
  }
}

export class OpenAIProvider implements AIProvider {
  constructor(
    private apiKey: string,
    private model: string,
  ) {}

  async complete(prompt: string, systemPrompt?: string): Promise<string> {
    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({ role: "user", content: prompt });

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model || "gpt-4o",
        messages,
        max_tokens: 2048,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${err}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content ?? "";
  }
}

export class OllamaProvider implements AIProvider {
  constructor(
    private baseUrl: string,
    private model: string,
  ) {}

  async complete(prompt: string, systemPrompt?: string): Promise<string> {
    const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;

    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model || "llama3.2",
        prompt: fullPrompt,
        stream: false,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Ollama error (${response.status}): ${err}`);
    }

    const data = await response.json();
    return data.response ?? "";
  }
}

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
