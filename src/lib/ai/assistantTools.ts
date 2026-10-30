import { invoke } from "@tauri-apps/api/core";
import type { ToolCall, ToolDefinition, ToolResult } from "@/lib/ai/types";
import { errorMessage } from "@/lib/errorMessage";

let listing: Promise<ToolDefinition[]> | null = null;

/** The read-only vault tools, listed once per session. None where the app
 *  has no tools to give (mobile); a failed listing is asked again next time. */
export function assistantTools(): Promise<ToolDefinition[]> {
  listing ??= invoke<ToolDefinition[]>("assistant_tools")
    .then((tools) =>
      tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    )
    .catch(() => {
      listing = null;
      return [];
    });
  return listing;
}

/** Run one call for this window. A refusal is a result too, so the model
 *  reads why. */
export async function runAssistantTool(
  call: ToolCall,
  activeNote: string | undefined,
): Promise<ToolResult> {
  const reply = { callId: call.id, name: call.name };
  try {
    const content = await invoke<string>("assistant_tool_call", {
      name: call.name,
      arguments: call.input,
      activeNote,
    });
    return { ...reply, content, isError: false };
  } catch (err) {
    return { ...reply, content: errorMessage(err), isError: true };
  }
}
