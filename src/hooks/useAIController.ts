import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAIChat } from "@/hooks/useAIChat";
import { type AIAction, type AIDocContext, actionPrompt } from "@/lib/aiPrompts";
import type { AISettings } from "@/lib/settings";

// Bundles the AI chat with the panel open state and the menu/context-menu
// quick-action handler. Quick actions open the panel and run as chat turns so
// the user can follow up. `doc` is the open document (content + path), read
// through a ref so its churn doesn't re-create the chat callbacks.
export function useAIController(aiSettings: AISettings, doc: AIDocContext | null) {
  const { t } = useTranslation("ai");
  const docRef = useRef(doc);
  docRef.current = doc;
  const getDocContext = useCallback(() => docRef.current, []);

  const chat = useAIChat(aiSettings, getDocContext);
  const [panelOpen, setPanelOpen] = useState(false);

  const runAction = useCallback(
    (action: string, selection?: string) => {
      setPanelOpen(true);
      const aiAction = action as AIAction;
      const display = t(`request.${selection ? "selection" : "document"}.${aiAction}`);
      void chat.send(actionPrompt(aiAction, selection), display);
    },
    [chat, t],
  );

  const togglePanel = useCallback(() => setPanelOpen((open) => !open), []);
  // Closing hides the panel but keeps the conversation for when it reopens.
  const closePanel = useCallback(() => setPanelOpen(false), []);

  const configured = aiSettings.provider !== "none";

  return { chat, panelOpen, togglePanel, closePanel, runAction, configured };
}
