import type { ChatMessage, ToolDefinition } from "@/lib/ai/types";

/** One read tool, as the registry describes it. */
export const READ_NOTE_TOOL: ToolDefinition = {
  name: "read_note",
  description: "A note's text.",
  inputSchema: { type: "object", properties: { ref: { type: "string" } }, required: ["ref"] },
};

/** A question the model met with two calls: one read, one refused. */
export const TOOL_CONVERSATION: ChatMessage[] = [
  { role: "user", content: "What does Cooking say?" },
  {
    role: "assistant",
    content: "Let me look.",
    toolCalls: [
      { id: "call_1", name: "read_note", input: { ref: "Cooking" } },
      { id: "call_2", name: "export", input: { ref: "Cooking" } },
    ],
  },
  {
    role: "tool",
    results: [
      { callId: "call_1", name: "read_note", content: '{"content":"Recipes"}', isError: false },
      { callId: "call_2", name: "export", content: "export is not available here", isError: true },
    ],
  },
];
