// The provider-agnostic chat surface every AI backend implements.

/** A tool the model may call, as the app's tool registry describes it. */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** One call the model asked for. `input` is an object when the arguments
 *  parsed, otherwise the raw text, which the tool refuses with a reason. */
export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResult {
  callId: string;
  name: string;
  content: string;
  isError: boolean;
}

export type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: readonly ToolCall[] }
  | { role: "tool"; results: readonly ToolResult[] };

export interface ChatOptions {
  system?: string;
  signal?: AbortSignal;
  /** Called with each streamed text delta as it arrives. */
  onChunk?: (delta: string) => void;
  /** Offered to the model, whose reply may then end in calls. */
  tools?: readonly ToolDefinition[];
}

export interface ChatReply {
  text: string;
  /** Empty when the model answered without calling a tool. */
  toolCalls: ToolCall[];
}

export interface AIProvider {
  /** Send a conversation and stream the reply. */
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatReply>;
}

/** The model refused the request because it was offered tools. */
export class ToolsUnsupportedError extends Error {
  name = "ToolsUnsupportedError";
}
