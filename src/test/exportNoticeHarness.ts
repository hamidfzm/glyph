import { type ExportNoticeActions, useExportNotice } from "@/hooks/useExportNotice";

/**
 * Wires an export hook to a real notice slot, so a test reads the notice the
 * user would see (and can raise one as another export would) instead of
 * asserting on callbacks.
 */
export function useWithExportNotice<Result extends object>(
  useHook: (actions: ExportNoticeActions) => Result,
) {
  const { notice, dismissNotice, ...actions } = useExportNotice();
  return { ...useHook(actions), ...actions, notice, dismissNotice };
}
