import { useCallback } from "react";
import { useTTS } from "@/hooks/useTTS";
import type { AISettings } from "@/lib/settings";

// Wraps useTTS with the toggle behavior the "Read Aloud" menu item needs:
// pressing it while speaking stops; pressing it otherwise speaks the current
// displayed content (if any). Returns the underlying tts handle for callers
// that need direct access (e.g. the AI panel's read-aloud button).
export function useReadAloudController(
  aiSettings: AISettings,
  getDisplayContent: () => string | null,
) {
  const tts = useTTS({ voice: aiSettings.ttsVoice, speed: aiSettings.ttsSpeed });

  const toggle = useCallback(() => {
    if (tts.speaking) {
      tts.stop();
      return;
    }
    const text = getDisplayContent();
    if (text) tts.speak(text);
  }, [tts, getDisplayContent]);

  return { tts, toggle };
}
