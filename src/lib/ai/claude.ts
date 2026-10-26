import { errorBody, sseData, streamLines } from "@/lib/ai/stream";
import { parseToolInput, toolInputObject } from "@/lib/ai/toolShapes";
import type {
  AIProvider,
  ChatMessage,
  ChatOptions,
  ChatReply,
  ToolDefinition,
} from "@/lib/ai/types";

interface StreamEvent {
  type?: string;
  index?: number;
  content_block?: { type?: string; id?: string; name?: string };
  delta?: { type?: string; text?: string; partial_json?: string };
  error?: { message?: string };
}

function requestMessages(messages: ChatMessage[]) {
  return messages.flatMap((message): Array<Record<string, unknown>> => {
    if (message.role === "user") return [{ role: "user", content: message.content }];
    if (message.role === "tool") {
      const results = message.results.map((result) => ({
        type: "tool_result",
        tool_use_id: result.callId,
        content: result.content,
        is_error: result.isError,
      }));
      return [{ role: "user", content: results }];
    }
    // The API refuses blank text, as a message or as a block.
    const text = message.content.trim() ? [{ type: "text", text: message.content }] : [];
    if (!message.toolCalls?.length) {
      return text.length > 0 ? [{ role: "assistant", content: message.content }] : [];
    }
    const calls = message.toolCalls.map((call) => ({
      type: "tool_use",
      id: call.id,
      name: call.name,
      input: toolInputObject(call.input),
    }));
    return [{ role: "assistant", content: [...text, ...calls] }];
  });
}

function requestTools(tools: readonly ToolDefinition[]) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));
}

export class ClaudeProvider implements AIProvider {
  constructor(
    private apiKey: string,
    private model: string,
  ) {}

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatReply> {
    const body: Record<string, unknown> = {
      model: this.model || "claude-sonnet-4-20250514",
      max_tokens: 4096,
      stream: true,
      messages: requestMessages(messages),
    };
    if (options.system) body.system = options.system;
    if (options.tools?.length) body.tools = requestTools(options.tools);

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
      const err = await errorBody(response);
      throw new Error(`Claude API error (${response.status}): ${err}`);
    }

    let text = "";
    let streamError: string | null = null;
    // Keyed by content block index: a call's arguments arrive as JSON pieces.
    const calls = new Map<number, { id: string; name: string; json: string }>();
    await streamLines(response, (line) => {
      const event = sseData(line) as StreamEvent | null;
      if (!event) return;
      if (event.type === "error") {
        streamError = event.error?.message ?? "stream error";
        return;
      }
      const block = event.content_block;
      if (event.type === "content_block_start" && block?.type === "tool_use") {
        calls.set(event.index ?? calls.size, {
          id: block.id ?? "",
          name: block.name ?? "",
          json: "",
        });
        return;
      }
      if (event.type !== "content_block_delta") return;
      const call = calls.get(event.index ?? -1);
      if (call && typeof event.delta?.partial_json === "string") {
        call.json += event.delta.partial_json;
      } else if (typeof event.delta?.text === "string") {
        text += event.delta.text;
        options.onChunk?.(event.delta.text);
      }
    });
    if (streamError) throw new Error(`Claude API error: ${streamError}`);
    const toolCalls = [...calls.values()].map(({ id, name, json }) => ({
      id,
      name,
      input: parseToolInput(json),
    }));
    return { text, toolCalls };
  }
}
