import { useTranslation } from "react-i18next";
import { AI_ACTIONS, type AIAction } from "@/lib/aiPrompts";

interface AIQuickActionsProps {
  onAction: (action: AIAction) => void;
  disabled?: boolean;
}

// One-click chips for the canned document actions; each runs as a chat turn.
export function AIQuickActions({ onAction, disabled }: AIQuickActionsProps) {
  const { t } = useTranslation("ai");
  return (
    <div className="ai-chips">
      {AI_ACTIONS.map((action) => (
        <button
          key={action}
          type="button"
          className="ai-chip"
          disabled={disabled}
          onClick={() => onAction(action)}
        >
          {t(`chip.${action}`)}
        </button>
      ))}
    </div>
  );
}
