import type { AISettings } from "./settings";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  system?: string;
  signal?: AbortSignal;
  /** Called with each streamed text delta as it arrives. */
  onChunk?: (delta: string) => void;
}

export interface AIProvider {
  /** Send a conversation and stream the reply. Resolves with the full text. */
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;
}

/**
 * Read a fetch response body as UTF-8 text lines (SSE and NDJSON are both
 * line-oriented). Falls back to splitting the full body when the environment
 * exposes no readable stream.
 */
async function streamLines(response: Response, onLine: (line: string) => void): Promise<void> {
  const body = response.body;
  if (!body) {
    for (const line of (await response.text()).split("\n")) onLine(line);
    return;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx = buffer.indexOf("\n");
    while (idx !== -1) {
      onLine(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 1);
      idx = buffer.indexOf("\n");
    }
  }
  buffer += decoder.decode();
  if (buffer) onLine(buffer);
}

/** Extract the JSON payload of an SSE `data:` line, or null for other lines. */
function sseData(line: string): unknown | null {
  if (!line.startsWith("data:")) return null;
  const payload = line.slice(5).trim();
  if (!payload || payload === "[DONE]") return null;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

export class ClaudeProvider implements AIProvider {
  constructor(
    private apiKey: string,
    private model: string,
  ) {}

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.model || "claude-sonnet-4-20250514",
      max_tokens: 4096,
      stream: true,
      messages,
    };
    if (options.system) body.system = options.system;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Claude API error (${response.status}): ${err}`);
    }

    let text = "";
    let streamError: string | null = null;
    await streamLines(response, (line) => {
      const event = sseData(line) as {
        type?: string;
        delta?: { text?: string };
        error?: { message?: string };
      } | null;
      if (!event) return;
      if (event.type === "error") {
        streamError = event.error?.message ?? "stream error";
        return;
      }
      if (event.type === "content_block_delta" && typeof event.delta?.text === "string") {
        text += event.delta.text;
        options.onChunk?.(event.delta.text);
      }
    });
    if (streamError) throw new Error(`Claude API error: ${streamError}`);
    return text;
  }
}

export class OpenAIProvider implements AIProvider {
  constructor(
    private apiKey: string,
    private model: string,
  ) {}

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
    const payload: Array<{ role: string; content: string }> = [];
    if (options.system) payload.push({ role: "system", content: options.system });
    payload.push(...messages);

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model || "gpt-4o",
        messages: payload,
        stream: true,
      }),
      signal: options.signal,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${err}`);
    }

    let text = "";
    await streamLines(response, (line) => {
      const event = sseData(line) as {
        choices?: Array<{ delta?: { content?: string } }>;
      } | null;
      const delta = event?.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta) {
        text += delta;
        options.onChunk?.(delta);
      }
    });
    return text;
  }
}

export class OllamaProvider implements AIProvider {
  constructor(
    private baseUrl: string,
    private model: string,
  ) {}

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
    const payload: Array<{ role: string; content: string }> = [];
    if (options.system) payload.push({ role: "system", content: options.system });
    payload.push(...messages);

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model || "llama3.2",
        messages: payload,
        stream: true,
      }),
      signal: options.signal,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Ollama error (${response.status}): ${err}`);
    }

    let text = "";
    let streamError: string | null = null;
    await streamLines(response, (line) => {
      if (!line.trim()) return;
      let event: { message?: { content?: string }; error?: string };
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      if (event.error) {
        streamError = event.error;
        return;
      }
      const delta = event.message?.content;
      if (typeof delta === "string" && delta) {
        text += delta;
        options.onChunk?.(delta);
      }
    });
    if (streamError) throw new Error(`Ollama error: ${streamError}`);
    return text;
  }
}

/** List the model tags installed on a local Ollama server. */
export async function fetchOllamaModels(baseUrl: string, signal?: AbortSignal): Promise<string[]> {
  const response = await fetch(`${baseUrl}/api/tags`, { signal });
  if (!response.ok) throw new Error(`Ollama error (${response.status})`);
  const data = (await response.json()) as { models?: Array<{ name?: string }> };
  return (data.models ?? []).map((m) => m.name ?? "").filter(Boolean);
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
