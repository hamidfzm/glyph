import { type AISettings, type AIToolProvider, ASSISTANT_TOOLS_DEFAULT } from "@/lib/settings";

// Ollama models that refused tool definitions, by server and model. Kept for
// the session only: the user may pull a newer build of the same model.
const refused = new Set<string>();

function modelKey(ai: AISettings): string {
  return `${ai.ollamaUrl}\0${ai.model}`;
}

export function rememberToolsRefused(ai: AISettings): void {
  refused.add(modelKey(ai));
}

/** The tools switch for `provider`: the user's choice, else the default. A
 *  hand-edited settings file may hold anything here. */
export function assistantToolsOn(ai: AISettings, provider: AIToolProvider): boolean {
  const chosen: unknown = (ai.assistantTools as Record<string, unknown> | null)?.[provider];
  return typeof chosen === "boolean" ? chosen : ASSISTANT_TOOLS_DEFAULT[provider];
}

/** Whether a reply may call the vault tools: the user allows it for this
 *  provider, and an Ollama model has not refused them. */
export function toolsOffered(ai: AISettings): boolean {
  if (ai.provider === "none") return false;
  if (ai.provider === "ollama" && refused.has(modelKey(ai))) return false;
  return assistantToolsOn(ai, ai.provider);
}
