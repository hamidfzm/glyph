import { type ComponentProps, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { LinkComponent } from "@/components/markdown/LinkComponent";
import type { ChatTurn } from "@/lib/ai/chatTurn";
import { MAX_TOOL_CALLS } from "@/lib/ai/toolLoop";
import { AIQuoteBlock } from "./AIQuoteBlock";
import { AIReplyImage } from "./AIReplyImage";
import { AIToolCalls } from "./AIToolCalls";

const NO_QUOTED_URLS: readonly string[] = [];

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

  // A model-chosen href must open in the system browser behind the
  // external-link prompt, never navigate the app webview; LinkComponent owns
  // that. A model-chosen image loads only when the document the reply was
  // asked about already named its URL: the reply is shaped by that document,
  // so a URL the model composed is a channel out of the user's notes. A URL
  // in a note the model read through a tool does not count: the user never
  // opened that note, so its view never fetched the image.
  const quotedUrls = turn.quotedImageUrls ?? NO_QUOTED_URLS;
  const components = useMemo(
    () => ({
      blockquote: AIQuoteBlock,
      a: LinkComponent,
      img: (props: ComponentProps<"img">) => <AIReplyImage {...props} quotedUrls={quotedUrls} />,
    }),
    [quotedUrls],
  );

  if (turn.role === "user") {
    return (
      <div className="ai-msg ai-msg-user" dir="auto">
        {turn.display ?? turn.content}
      </div>
    );
  }

  const calls = turn.toolCalls;
  if (pending) {
    return (
      <div className="ai-msg ai-msg-assistant">
        {calls && <AIToolCalls calls={calls} />}
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
      {calls && <AIToolCalls calls={calls} />}
      {turn.content && (
        <div className="markdown-body ai-msg-markdown" dir="auto">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
            {turn.content}
          </ReactMarkdown>
        </div>
      )}
      {turn.toolsSkipped && <div className="ai-tool-call-note">{t("tools.unsupported")}</div>}
      {turn.stoppedAtBudget && (
        <div className="ai-tool-call-note">{t("tools.budget", { limit: MAX_TOOL_CALLS })}</div>
      )}
      {turn.content && (
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
      )}
    </div>
  );
}
