import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type ChatMessage, createAIProvider } from "@/lib/ai-providers";
import { type AIDocContext, buildSystemPrompt } from "@/lib/aiPrompts";
import type { AISettings } from "@/lib/settings";

export interface ChatTurn {
  id: number;
  role: "user" | "assistant";
  /** What is sent to the model. */
  content: string;
  /** Short label shown in the transcript instead of `content` (quick actions
   *  embed long passages the user shouldn't have to re-read). */
  display?: string;
}

/**
 * Streaming multi-turn chat against the configured AI provider. The open
 * document rides along as the system prompt (via `getDocContext`, read fresh
 * on every send). Assistant turns fill in token-by-token as chunks arrive.
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
      const provider = createAIProvider(aiSettings);
      if (!provider) {
        setError(t("error.notConfigured"));
        return;
      }

      // A new send cancels any in-flight stream (its partial turn is kept).
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setError(null);

      const history: ChatMessage[] = turnsRef.current
        .filter((turn) => turn.content)
        .map(({ role, content: c }) => ({ role, content: c }));
      history.push({ role: "user", content });

      const userId = ++idRef.current;
      const assistantId = ++idRef.current;
      setTurns((prev) => [
        ...prev,
        { id: userId, role: "user", content, display },
        { id: assistantId, role: "assistant", content: "" },
      ]);
      setStreaming(true);

      try {
        const full = await provider.chat(history, {
          system: buildSystemPrompt(getDocContext()),
          signal: controller.signal,
          onChunk: (delta) =>
            setTurns((prev) =>
              prev.map((turn) =>
                turn.id === assistantId ? { ...turn, content: turn.content + delta } : turn,
              ),
            ),
        });
        // Reconcile with the resolved text so a reply that arrived without
        // chunk callbacks (non-streaming fallback) still fills the turn.
        setTurns((prev) =>
          prev.map((turn) =>
            turn.id === assistantId && turn.content !== full ? { ...turn, content: full } : turn,
          ),
        );
      } catch (err) {
        // Stop/abort keeps whatever streamed in; real failures also surface
        // the error. Either way an assistant turn that never got a token is
        // dropped rather than left as an empty bubble.
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setError(err instanceof Error ? err.message : String(err));
        }
        setTurns((prev) => prev.filter((turn) => turn.id !== assistantId || turn.content));
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
