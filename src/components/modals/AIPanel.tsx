import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ModalCloseIcon } from "@/components/icons/ModalCloseIcon";
import type { AIAction } from "@/hooks/useAI";

interface AIPanelProps {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  result: string | null;
  error: string | null;
  action: AIAction | null;
  onReadAloud?: (text: string) => void;
  speaking?: boolean;
  onStopReading?: () => void;
}

export function AIPanel({
  open,
  onClose,
  loading,
  result,
  error,
  action,
  onReadAloud,
  speaking,
  onStopReading,
}: AIPanelProps) {
  const { t } = useTranslation("ai");
  const handleCopy = useCallback(() => {
    if (result) {
      navigator.clipboard.writeText(result);
    }
  }, [result]);

  return (
    <div className="ai-panel" data-open={open}>
      <div className="ai-panel-header">
        <h3>{action ? t(`actionLabel.${action}`) : t("title")}</h3>
        <button type="button" className="settings-close" onClick={onClose}>
          <ModalCloseIcon />
        </button>
      </div>

      <div className="ai-panel-body">
        {loading && (
          <div className="ai-loading">
            <div className="ai-spinner" />
            <span>{t("processing")}</span>
          </div>
        )}

        {error && <div className="ai-error">{error}</div>}

        {result && (
          <div className="markdown-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{result}</ReactMarkdown>
          </div>
        )}

        {!loading && !error && !result && (
          <div
            style={{
              color: "var(--color-text-tertiary)",
              fontSize: 13,
              textAlign: "center",
              padding: "40px 0",
            }}
          >
            {t("empty")}
          </div>
        )}
      </div>

      {result && (
        <div className="ai-panel-footer">
          {onReadAloud &&
            (speaking ? (
              <button type="button" className="ai-panel-btn" onClick={onStopReading}>
                {t("stopReading")}
              </button>
            ) : (
              <button type="button" className="ai-panel-btn" onClick={() => onReadAloud(result)}>
                {t("readAloud")}
              </button>
            ))}
          <button type="button" className="ai-panel-btn" onClick={handleCopy}>
            {t("copy")}
          </button>
        </div>
      )}
    </div>
  );
}
