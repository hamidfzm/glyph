import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { ToolCallView } from "@/lib/ai/chatTurn";
import { prettyJson, shownResult } from "@/lib/ai/toolCallDisplay";

export function AIToolCallDetail({ view }: { view: ToolCallView }) {
  const { t } = useTranslation("ai");
  const shown = useMemo(
    () => (view.result === undefined ? null : shownResult(view.result)),
    [view.result],
  );

  return (
    <div className="ai-tool-call-detail">
      <div className="ai-tool-call-label">{t("tools.arguments")}</div>
      <pre>{prettyJson(view.call.input)}</pre>
      {shown && (
        <>
          <div className="ai-tool-call-label">{t("tools.result")}</div>
          <pre>{shown.text}</pre>
          {shown.cut && (
            <div className="ai-tool-call-note">
              {t("tools.resultCut", { shown: shown.text.length, total: shown.total })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
