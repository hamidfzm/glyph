import { useEffect, useState } from "react";
import { fetchOllamaModels } from "@/lib/ai-providers";

// Debounce so a URL being typed character-by-character doesn't fire a fetch
// per keystroke.
const FETCH_DEBOUNCE_MS = 400;

export type OllamaModelsStatus = "idle" | "loading" | "ok" | "error";

export interface OllamaModels {
  /** Model tags installed on the server; empty unless status is "ok". */
  models: string[];
  status: OllamaModelsStatus;
}

/**
 * The model tags installed on the Ollama server at `url`, plus a status the
 * settings UI surfaces as connection feedback. Refreshes when the URL
 * changes; `enabled` gates the fetch to the Ollama provider.
 */
export function useOllamaModels(url: string, enabled: boolean): OllamaModels {
  const [state, setState] = useState<OllamaModels>({ models: [], status: "idle" });

  useEffect(() => {
    if (!enabled || !url) {
      setState({ models: [], status: "idle" });
      return;
    }
    setState({ models: [], status: "loading" });
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetchOllamaModels(url, controller.signal)
        .then((names) => setState({ models: names, status: "ok" }))
        .catch(() => {
          // An abort means the URL changed or we unmounted; only a real
          // failure (server down, CORS) becomes the error state.
          if (!controller.signal.aborted) setState({ models: [], status: "error" });
        });
    }, FETCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [url, enabled]);

  return state;
}
