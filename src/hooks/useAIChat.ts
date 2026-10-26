import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { assistantTools, runAssistantTool } from "@/lib/ai/assistantTools";
import {
  type ChatTurn,
  chatHistory,
  withReplyEnded,
  withRunningStopped,
  withToolCall,
  withToolResult,
} from "@/lib/ai/chatTurn";
import type { ToolLoopEnd } from "@/lib/ai/toolLoop";
import { rememberToolsRefused, toolsOffered, toolsRefusedByModel } from "@/lib/ai/toolSupport";
import { type ToolDefinition, ToolsUnsupportedError } from "@/lib/ai/types";
import { type AIDocContext, buildSystemPrompt } from "@/lib/aiPrompts";
import { errorMessage } from "@/lib/errorMessage";
import { quotedImageUrls } from "@/lib/quotedImageUrls";
import type { AISettings } from "@/lib/settings";

/**
 * Streaming multi-turn chat against the configured AI provider. The open
 * document rides along as the system prompt (via `getDocContext`, read fresh
 * on every send). Where the provider takes tools, the model may read the
 * window's notes through them first; each call shows on the reply.
 */
export function useAIChat(aiSettings: AISettings, getDocContext: () => AIDocContext | null) {
  const { t } = useTranslation("ai");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const idRef = useRef(0);
  // Mirror of `turns` so `send` can read the up-to-date history without
  // re-creating itself on every streamed chunk.
  const turnsRef = useRef<ChatTurn[]>([]);
  turnsRef.current = turns;

  const send = useCallback(
    async (content: string, display?: string) => {
      // Loaded on first use, to keep the providers and the loop out of the
      // startup bundle.
      const [{ createAIProvider }, { runToolLoop }] = await Promise.all([
        import("@/lib/ai-providers"),
        import("@/lib/ai/toolLoop"),
      ]);
      const provider = createAIProvider(aiSettings);
      if (!provider) {
        setError(t("error.notConfigured"));
        return;
      }

      // A new send cancels any in-flight reply (its partial turn is kept).
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setError(null);

      const previous = turnsRef.current;
      // Read once per send: the history outlives document switches, so the
      // reply keeps the URLs of the document it was asked about.
      const doc = getDocContext();
      const userId = ++idRef.current;
      const assistantId = ++idRef.current;
      setTurns((prev) => [
        ...prev,
        { id: userId, role: "user", content, display },
        {
          id: assistantId,
          role: "assistant",
          content: "",
          quotedImageUrls: quotedImageUrls(doc?.content ?? ""),
        },
      ]);
      setStreaming(true);
      const update = (change: (turn: ChatTurn) => ChatTurn) =>
        setTurns((prev) => prev.map((turn) => (turn.id === assistantId ? change(turn) : turn)));
      // An assistant turn that never got a token or a call is dropped rather
      // than left as an empty bubble.
      const finish = (change: (turn: ChatTurn) => ChatTurn) =>
        setTurns((prev) =>
          prev
            .map((turn) => (turn.id === assistantId ? change(turn) : turn))
            .filter((turn) => turn.id !== assistantId || turn.content || turn.toolCalls),
        );

      try {
        const ask = (tools: readonly ToolDefinition[]) =>
          runToolLoop({
            provider,
            history: [...chatHistory(previous, tools.length > 0), { role: "user", content }],
            system: buildSystemPrompt(doc, { tools: tools.length > 0 }),
            tools,
            signal: controller.signal,
            onChunk: (delta) => update((turn) => ({ ...turn, content: turn.content + delta })),
            onCall: (call) => update((turn) => withToolCall(turn, call)),
            onResult: (result) => update((turn) => withToolResult(turn, result)),
            runTool: (call) => runAssistantTool(call, doc?.path),
          });
        // The tools read the window's workspace, so without one they have nothing to read.
        const offered = Boolean(doc?.workspaceRoot) && toolsOffered(aiSettings);
        const tools = offered ? await assistantTools() : [];
        let ended: ToolLoopEnd;
        try {
          ended = await ask(tools);
        } catch (err) {
          if (!(err instanceof ToolsUnsupportedError)) throw err;
          // This model takes no tools: answer as before, from the prompt alone.
          rememberToolsRefused(aiSettings);
          ended = await ask([]);
        }
        // Said on the reply: an answer without the tools is not the one asked for.
        const toolsSkipped = Boolean(doc?.workspaceRoot) && toolsRefusedByModel(aiSettings);
        finish((turn) => ({ ...withReplyEnded(turn, ended), toolsSkipped }));
      } catch (err) {
        setError(errorMessage(err));
        finish(withRunningStopped);
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setStreaming(false);
        }
      }
    },
    [aiSettings, getDocContext, t],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    setTurns([]);
    setError(null);
  }, []);

  return { turns, streaming, error, send, stop, clear };
}
