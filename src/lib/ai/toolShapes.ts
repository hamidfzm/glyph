// Tool definitions and call arguments in the shapes the provider APIs take.

import type { ToolDefinition } from "@/lib/ai/types";

/** Tools in the `function` shape OpenAI and Ollama both take. */
export function functionTools(tools: readonly ToolDefinition[]) {
  return tools.map((tool) => ({
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
  }));
}

/** Streamed argument text as the call's input: parsed when it parses, else
 *  the text itself, which the tool refuses with a reason the model can use. */
export function parseToolInput(raw: string): unknown {
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** For an API that takes the arguments only as an object. */
export function toolInputObject(input: unknown): Record<string, unknown> {
  const isObject = typeof input === "object" && input !== null && !Array.isArray(input);
  return isObject ? (input as Record<string, unknown>) : {};
}
