// Binds the active tab to the source-rewrite action exposed by `useTabs`.
// Exists so the toggle callback handed to MarkdownViewer/SplitView is owned
// by a single small module instead of accreting in `App.tsx`.
import { useCallback } from "react";

interface UseTaskListOptions {
  activeTabId: string | null;
  toggleTask: (tabId: string, line: number) => Promise<void>;
}

export function useTaskList({ activeTabId, toggleTask }: UseTaskListOptions) {
  const handleToggle = useCallback(
    (line: number) => {
      if (activeTabId) toggleTask(activeTabId, line);
    },
    [activeTabId, toggleTask],
  );

  return { handleToggle };
}
