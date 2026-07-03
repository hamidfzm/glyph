import { type UIEvent, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ClearChatIcon } from "@/components/icons/ClearChatIcon";
import { ModalCloseIcon } from "@/components/icons/ModalCloseIcon";
import { ResizeHandle } from "@/components/layout/ResizeHandle";
import type { ChatTurn } from "@/hooks/useAIChat";
import { usePanelResize } from "@/hooks/usePanelResize";
import { useSettings } from "@/hooks/useSettings";
import type { AIAction } from "@/lib/aiPrompts";
import {
  AI_PANEL_WIDTH_DEFAULT,
  AI_PANEL_WIDTH_MAX_FRACTION,
  AI_PANEL_WIDTH_MIN,
} from "@/lib/settings";
import { AIChatComposer } from "./AIChatComposer";
import { AIChatMessage } from "./AIChatMessage";
import { AIQuickActions } from "./AIQuickActions";

interface AIChatPanelProps {
  open: boolean;
  onClose: () => void;
  turns: ChatTurn[];
  streaming: boolean;
  error: string | null;
  configured: boolean;
  /** True when a document with text content is open in the active tab. */
  hasDocument: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  onClear: () => void;
  onQuickAction: (action: AIAction) => void;
  onReadAloud?: (text: string) => void;
  speaking?: boolean;
  onStopReading?: () => void;
}

// The AI assistant sidebar. Docked in the content row beside the document
// (never overlaying it); hidden entirely when closed.
export function AIChatPanel({
  open,
  onClose,
  turns,
  streaming,
  error,
  configured,
  hasDocument,
  onSend,
  onStop,
  onClear,
  onQuickAction,
  onReadAloud,
  speaking,
  onStopReading,
}: AIChatPanelProps) {
  const { t } = useTranslation("ai");
  const { settings, updateSettings } = useSettings();
  const { size, handleProps } = usePanelResize({
    size: settings.layout.aiPanelWidth,
    min: AI_PANEL_WIDTH_MIN,
    max: () => Math.round(window.innerWidth * AI_PANEL_WIDTH_MAX_FRACTION),
    axis: "x",
    // Docked at the inline-end edge: dragging toward inline-start grows it.
    direction: () => (document.documentElement.dir === "rtl" ? 1 : -1),
    onCommit: (width) => updateSettings("layout.aiPanelWidth", width),
    onReset: () => updateSettings("layout.aiPanelWidth", AI_PANEL_WIDTH_DEFAULT),
  });
  const bodyRef = useRef<HTMLDivElement>(null);
  // Follow the stream only while the user is at the bottom; scrolling up to
  // re-read pauses the auto-scroll until they return.
  const pinnedRef = useRef(true);

  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  useEffect(() => {
    if (turns.length === 0) return;
    const el = bodyRef.current;
    if (open && el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [open, turns]);

  return (
    <aside
      className="ai-chat-panel"
      data-open={open}
      aria-label={t("title")}
      style={{ width: size ?? undefined }}
    >
      <ResizeHandle
        axis="x"
        label={t("resize")}
        value={size ?? settings.layout.aiPanelWidth}
        min={AI_PANEL_WIDTH_MIN}
        max={window.innerWidth * AI_PANEL_WIDTH_MAX_FRACTION}
        className="absolute inset-y-0 start-0 w-1.5"
        {...handleProps}
      />
      <div className="ai-chat-header">
        <h3>{t("title")}</h3>
        <div className="ai-chat-header-actions">
          {turns.length > 0 && (
            <button
              type="button"
              className="ai-chat-header-btn"
              onClick={onClear}
              aria-label={t("clear")}
              title={t("clear")}
            >
              <ClearChatIcon />
            </button>
          )}
          <button
            type="button"
            className="ai-chat-header-btn"
            onClick={onClose}
            aria-label={t("close")}
            title={t("close")}
          >
            <ModalCloseIcon />
          </button>
        </div>
      </div>

      <div className="ai-chat-body" ref={bodyRef} onScroll={handleScroll}>
        {!configured && <div className="ai-error">{t("error.notConfigured")}</div>}
        {configured && turns.length === 0 && (
          <div className="ai-chat-empty">{hasDocument ? t("empty") : t("emptyNoDoc")}</div>
        )}
        {turns.map((turn, index) => (
          <AIChatMessage
            key={turn.id}
            turn={turn}
            pending={
              streaming && index === turns.length - 1 && turn.role === "assistant" && !turn.content
            }
            onReadAloud={onReadAloud}
            speaking={speaking}
            onStopReading={onStopReading}
          />
        ))}
        {error && <div className="ai-error">{error}</div>}
      </div>

      {configured && hasDocument && (
        <AIQuickActions onAction={onQuickAction} disabled={streaming} />
      )}
      <AIChatComposer
        streaming={streaming}
        disabled={!configured}
        placeholder={hasDocument ? t("placeholder") : t("placeholderNoDoc")}
        onSend={onSend}
        onStop={onStop}
      />
    </aside>
  );
}
