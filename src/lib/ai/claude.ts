import { sseData, streamLines } from "@/lib/ai/stream";
import type { AIProvider, ChatMessage, ChatOptions } from "@/lib/ai/types";

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
