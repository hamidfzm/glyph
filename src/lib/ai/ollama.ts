import { streamLines } from "@/lib/ai/stream";
import type { AIProvider, ChatMessage, ChatOptions } from "@/lib/ai/types";

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
