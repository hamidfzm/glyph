import { useCallback } from "react";
import { useSettings } from "@/hooks/useSettings";

/**
 * Compose the flushes run when a native window close is intercepted: pending
 * settings and the workspace session snapshot first (a failed write never
 * blocks the close), then dirty documents, whose result decides whether the
 * window may close.
 */
export function useCloseFlush(
  flushDocuments: () => Promise<boolean>,
  flushSession: () => Promise<void>,
) {
  const { flushSettings } = useSettings();
  return useCallback(async () => {
    await flushSettings();
    await flushSession();
    return flushDocuments();
  }, [flushSettings, flushSession, flushDocuments]);
}
