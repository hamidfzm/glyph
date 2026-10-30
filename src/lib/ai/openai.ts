import { errorBody, sseData, streamLines } from "@/lib/ai/stream";
import { functionTools, parseToolInput } from "@/lib/ai/toolShapes";
import type { AIProvider, ChatMessage, ChatOptions, ChatReply } from "@/lib/ai/types";

interface StreamEvent {
  choices?: Array<{
    delta?: {
      content?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
}

function requestMessages(system: string | undefined, messages: ChatMessage[]) {
  const payload: Array<Record<string, unknown>> = [];
  if (system) payload.push({ role: "system", content: system });
  for (const message of messages) {
    if (message.role === "tool") {
      for (const result of message.results) {
        payload.push({ role: "tool", tool_call_id: result.callId, content: result.content });
      }
    } else if (message.role === "assistant" && message.toolCalls?.length) {
      payload.push({
        role: "assistant",
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          // Arguments that did not parse go back as the text they came as.
          function: {
            name: call.name,
            arguments: typeof call.input === "string" ? call.input : JSON.stringify(call.input),
          },
        })),
      });
    } else {
      payload.push({ role: message.role, content: message.content });
    }
  }
  return payload;
}

export class OpenAIProvider implements AIProvider {
  constructor(
    private apiKey: string,
    private model: string,
  ) {}

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatReply> {
    const body: Record<string, unknown> = {
      model: this.model || "gpt-4o",
      messages: requestMessages(options.system, messages),
      stream: true,
    };
    if (options.tools?.length) body.tools = functionTools(options.tools);

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!response.ok) {
      const err = await errorBody(response);
      throw new Error(`OpenAI API error (${response.status}): ${err}`);
    }

    let text = "";
    // Keyed by the call's index: its id and name come first, its arguments in pieces.
    const calls = new Map<number, { id: string; name: string; args: string }>();
    await streamLines(response, (line) => {
      const delta = (sseData(line) as StreamEvent | null)?.choices?.[0]?.delta;
      for (const piece of delta?.tool_calls ?? []) {
        const index = piece.index ?? 0;
        const call = calls.get(index) ?? { id: "", name: "", args: "" };
        call.id ||= piece.id ?? "";
        call.name ||= piece.function?.name ?? "";
        call.args += piece.function?.arguments ?? "";
        calls.set(index, call);
      }
      const content = delta?.content;
      if (typeof content === "string" && content) {
        text += content;
        options.onChunk?.(content);
      }
    });
    const toolCalls = [...calls.values()].map(({ id, name, args }) => ({
      id,
      name,
      input: parseToolInput(args),
    }));
    return { text, toolCalls };
  }
}
