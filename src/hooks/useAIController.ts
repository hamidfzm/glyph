import { useCallback, useState } from "react";
import { type AIAction, useAI } from "@/hooks/useAI";
import type { AISettings } from "@/lib/settings";

// Bundles useAI with the AI-panel open state and the menu-driven action
// handler. The panel opens automatically when an action fires.
export function useAIController(aiSettings: AISettings) {
  const ai = useAI(aiSettings);
  const [panelOpen, setPanelOpen] = useState(false);

  const runAction = useCallback(
    (action: string, text: string) => {
      setPanelOpen(true);
      ai.run(action as AIAction, text);
    },
    [ai],
  );

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    ai.clear();
  }, [ai]);

  const configured = aiSettings.provider !== "none";

  return { ai, panelOpen, runAction, closePanel, configured };
}
