import { useTranslation } from "react-i18next";
import type { ToolCallView } from "@/lib/ai/chatTurn";
import { AIToolCall } from "./AIToolCall";

export function AIToolCalls({ calls }: { calls: readonly ToolCallView[] }) {
  const { t } = useTranslation("ai");
  return (
    <ul className="ai-tool-calls" aria-label={t("tools.label")}>
      {calls.map((view) => (
        <AIToolCall key={view.key} view={view} />
      ))}
    </ul>
  );
}
