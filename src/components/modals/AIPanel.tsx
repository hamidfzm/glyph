import { useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AIAction } from "../../hooks/useAI";

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

const ACTION_LABELS: Record<AIAction, string> = {
  summarize: "Summary",
  explain: "Explanation",
  translate: "Translation",
  simplify: "Simplified",
};

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
  const handleCopy = useCallback(() => {
    if (result) {
      navigator.clipboard.writeText(result);
    }
  }, [result]);

  return (
    <div className="ai-panel" data-open={open}>
      <div className="ai-panel-header">
        <h3>{action ? ACTION_LABELS[action] : "AI"}</h3>
        <button className="settings-close" onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="ai-panel-body">
        {loading && (
          <div className="ai-loading">
            <div className="ai-spinner" />
            <span>Processing...</span>
          </div>
        )}

        {error && <div className="ai-error">{error}</div>}

        {result && (
          <div className="markdown-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{result}</ReactMarkdown>
          </div>
        )}

        {!loading && !error && !result && (
          <div style={{ color: "var(--color-text-tertiary)", fontSize: 13, textAlign: "center", padding: "40px 0" }}>
            Use the AI menu or context menu to run an action.
          </div>
        )}
      </div>

      {result && (
        <div className="ai-panel-footer">
          {onReadAloud && (
            speaking ? (
              <button className="ai-panel-btn" onClick={onStopReading}>
                Stop Reading
              </button>
            ) : (
              <button className="ai-panel-btn" onClick={() => onReadAloud(result)}>
                Read Aloud
              </button>
            )
          )}
          <button className="ai-panel-btn" onClick={handleCopy}>
            Copy
          </button>
        </div>
      )}
    </div>
  );
}
