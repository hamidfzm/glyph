import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ToolCallView } from "@/lib/ai/chatTurn";
import { incompleteIndex, toolCallSubject } from "@/lib/ai/toolCallDisplay";
import { indexIncompleteKey } from "@/lib/workspaceScan";
import { AIToolCallDetail } from "./AIToolCallDetail";

export function AIToolCall({ view }: { view: ToolCallView }) {
  const { t } = useTranslation("ai");
  // The detail renders only while open: a result can run to a megabyte.
  const [open, setOpen] = useState(false);
  const subject = toolCallSubject(view.call.input);
  // Parsed once per result, not on every streamed chunk of the reply.
  const incomplete = useMemo(
    () => (view.result === undefined ? null : incompleteIndex(view.result)),
    [view.result],
  );

  return (
    <li className="ai-tool-call" data-status={view.status}>
      <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>
          <span className="ai-tool-call-name">
            {t(`tools.names.${view.call.name}`, { defaultValue: view.call.name })}
          </span>
          {subject && (
            <span className="ai-tool-call-subject" dir="auto">
              {subject}
            </span>
          )}
          {view.status !== "done" && (
            <span className="ai-tool-call-status">{t(`tools.status.${view.status}`)}</span>
          )}
        </summary>
        {open && <AIToolCallDetail view={view} />}
      </details>
      {incomplete && (
        <div className="ai-tool-call-note">
          {t(indexIncompleteKey(incomplete.reason), {
            ns: "workspace",
            limit: incomplete.limit ?? 0,
          })}
        </div>
      )}
    </li>
  );
}
