import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatTurn } from "@/hooks/useAIChat";
import { AIQuoteBlock } from "./AIQuoteBlock";

interface AIChatMessageProps {
  turn: ChatTurn;
  /** True while this turn is the streaming reply that hasn't produced text yet. */
  pending?: boolean;
  onReadAloud?: (text: string) => void;
  speaking?: boolean;
  onStopReading?: () => void;
}

export function AIChatMessage({
  turn,
  pending,
  onReadAloud,
  speaking,
  onStopReading,
}: AIChatMessageProps) {
  const { t } = useTranslation("ai");

  const handleCopy = useCallback(() => {
    // Best-effort copy; nothing to recover if the clipboard write is denied.
    void navigator.clipboard.writeText(turn.content).catch(() => undefined);
  }, [turn.content]);

  if (turn.role === "user") {
    return <div className="ai-msg ai-msg-user">{turn.display ?? turn.content}</div>;
  }

  if (pending) {
    return (
      <div className="ai-msg ai-msg-assistant">
        <div className="ai-typing" role="status" aria-label={t("thinking")}>
          <span />
          <span />
          <span />
        </div>
      </div>
    );
  }

  return (
    <div className="ai-msg ai-msg-assistant">
      <div className="markdown-body ai-msg-markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ blockquote: AIQuoteBlock }}>
          {turn.content}
        </ReactMarkdown>
      </div>
      <div className="ai-msg-actions">
        <button type="button" className="ai-msg-action" onClick={handleCopy}>
          {t("copy")}
        </button>
        {onReadAloud &&
          (speaking ? (
            <button type="button" className="ai-msg-action" onClick={onStopReading}>
              {t("stopReading")}
            </button>
          ) : (
            <button
              type="button"
              className="ai-msg-action"
              onClick={() => onReadAloud(turn.content)}
            >
              {t("readAloud")}
            </button>
          ))}
      </div>
    </div>
  );
}
