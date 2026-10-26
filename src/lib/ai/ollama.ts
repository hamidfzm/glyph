import { errorBody, streamLines } from "@/lib/ai/stream";
import { functionTools, parseToolInput, toolInputObject } from "@/lib/ai/toolShapes";
import {
  type AIProvider,
  type ChatMessage,
  type ChatOptions,
  type ChatReply,
  type ToolCall,
  ToolsUnsupportedError,
} from "@/lib/ai/types";

interface StreamEvent {
  message?: {
    content?: string;
    tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: unknown } }>;
  };
  error?: string;
}

function requestMessages(system: string | undefined, messages: ChatMessage[]) {
  const payload: Array<Record<string, unknown>> = [];
  if (system) payload.push({ role: "system", content: system });
  for (const message of messages) {
    if (message.role === "tool") {
      for (const result of message.results) {
        payload.push({ role: "tool", tool_name: result.name, content: result.content });
      }
    } else if (message.role === "assistant" && message.toolCalls?.length) {
      payload.push({
        role: "assistant",
        content: message.content,
        tool_calls: message.toolCalls.map((call) => ({
          function: { name: call.name, arguments: toolInputObject(call.input) },
        })),
      });
    } else {
      payload.push({ role: message.role, content: message.content });
    }
  }
  return payload;
}

export class OllamaProvider implements AIProvider {
  // Ids for calls that come without one, unique across a reply's rounds: a
  // reply replayed to another provider may need each id once.
  private unnamedCalls = 0;

  constructor(
    private baseUrl: string,
    private model: string,
  ) {}

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatReply> {
    const tools = options.tools ?? [];
    const body: Record<string, unknown> = {
      model: this.model || "llama3.2",
      messages: requestMessages(options.system, messages),
      stream: true,
    };
    if (tools.length) body.tools = functionTools(tools);

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!response.ok) {
      const err = await errorBody(response);
      // Tool support is the model's: one without it refuses the definitions.
      if (tools.length && response.status === 400 && err.includes("does not support tools")) {
        throw new ToolsUnsupportedError(`Ollama error (${response.status}): ${err}`);
      }
      throw new Error(`Ollama error (${response.status}): ${err}`);
    }

    let text = "";
    let streamError: string | null = null;
    const toolCalls: ToolCall[] = [];
    await streamLines(response, (line) => {
      if (!line.trim()) return;
      let event: StreamEvent;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      if (event.error) {
        streamError = event.error;
        return;
      }
      // Ollama sends each call whole, and older servers give it no id.
      for (const call of event.message?.tool_calls ?? []) {
        const args = call.function?.arguments;
        toolCalls.push({
          id: call.id ?? `call_${this.unnamedCalls++}`,
          name: call.function?.name ?? "",
          input: typeof args === "string" ? parseToolInput(args) : (args ?? {}),
        });
      }
      const delta = event.message?.content;
      if (typeof delta === "string" && delta) {
        text += delta;
        options.onChunk?.(delta);
      }
    });
    if (streamError) throw new Error(`Ollama error: ${streamError}`);
    return { text, toolCalls };
  }
}

/** List the model tags installed on a local Ollama server. */
export async function fetchOllamaModels(baseUrl: string, signal?: AbortSignal): Promise<string[]> {
  const response = await fetch(`${baseUrl}/api/tags`, { signal });
  if (!response.ok) throw new Error(`Ollama error (${response.status})`);
  const data = (await response.json()) as { models?: Array<{ name?: string }> };
  return (data.models ?? []).map((m) => m.name ?? "").filter(Boolean);
}
