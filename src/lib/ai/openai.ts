import { sseData, streamLines } from "@/lib/ai/stream";
import type { AIProvider, ChatMessage, ChatOptions } from "@/lib/ai/types";

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
