import { useState, useCallback, useRef } from "react";
import { createAIProvider } from "../lib/ai-providers";
import type { AISettings } from "../lib/settings";

export type AIAction = "summarize" | "explain" | "translate" | "simplify";

interface AIState {
  loading: boolean;
  result: string | null;
  error: string | null;
  action: AIAction | null;
}

const ACTION_PROMPTS: Record<AIAction, { system: string; user: (text: string) => string }> = {
  summarize: {
    system: "You are a helpful assistant that creates clear, concise summaries. Respond in markdown.",
    user: (text) => `Summarize the following document concisely:\n\n${text}`,
  },
  explain: {
    system: "You are a helpful assistant that explains content clearly. Respond in markdown.",
    user: (text) => `Explain the following content in simple terms:\n\n${text}`,
  },
  translate: {
    system: "You are a helpful translator. Detect the source language and translate to English. If already in English, translate to Spanish. Respond in markdown.",
    user: (text) => `Translate the following text:\n\n${text}`,
  },
  simplify: {
    system: "You are a helpful assistant that simplifies complex text to be easily understood. Use simple words and short sentences. Respond in markdown.",
    user: (text) => `Simplify the following text:\n\n${text}`,
  },
};

export function useAI(aiSettings: AISettings) {
  const [state, setState] = useState<AIState>({
    loading: false,
    result: null,
    error: null,
    action: null,
  });
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(
    async (action: AIAction, text: string) => {
      const provider = createAIProvider(aiSettings);
      if (!provider) {
        setState({
          loading: false,
          result: null,
          error: "No AI provider configured. Open Settings to set up an AI provider.",
          action,
        });
        return;
      }

      // Cancel any in-flight request
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      setState({ loading: true, result: null, error: null, action });

      try {
        const prompts = ACTION_PROMPTS[action];
        const result = await provider.complete(prompts.user(text), prompts.system);
        setState({ loading: false, result, error: null, action });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setState({
          loading: false,
          result: null,
          error: err instanceof Error ? err.message : String(err),
          action,
        });
      }
    },
    [aiSettings],
  );

  const clear = useCallback(() => {
    abortRef.current?.abort();
    setState({ loading: false, result: null, error: null, action: null });
  }, []);

  return { ...state, run, clear };
}
