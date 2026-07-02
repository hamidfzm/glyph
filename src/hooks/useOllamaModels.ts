import { useEffect, useState } from "react";
import { fetchOllamaModels } from "@/lib/ai-providers";
import { MODEL_SUGGESTIONS } from "@/lib/settings";

// Debounce so a URL being typed character-by-character doesn't fire a fetch
// per keystroke.
const FETCH_DEBOUNCE_MS = 400;

/**
 * The model tags installed on the Ollama server at `url`, for the settings
 * datalist. Falls back to the built-in suggestions while loading and whenever
 * the server is unreachable, so the field keeps working offline. Refreshes
 * when the URL changes; `enabled` gates the fetch to the Ollama provider.
 */
export function useOllamaModels(url: string, enabled: boolean): string[] {
  const [models, setModels] = useState<string[]>([]);

  useEffect(() => {
    if (!enabled || !url) {
      setModels([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetchOllamaModels(url, controller.signal)
        .then((names) => setModels(names))
        // Unreachable server (or abort) keeps the fallback suggestions.
        .catch(() => setModels([]));
    }, FETCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [url, enabled]);

  return models.length > 0 ? models : MODEL_SUGGESTIONS.ollama;
}
