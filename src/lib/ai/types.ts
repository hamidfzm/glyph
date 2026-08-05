// The provider-agnostic chat surface every AI backend implements.

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
