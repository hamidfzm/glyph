import { useCallback } from "react";
import { useSettings } from "@/hooks/useSettings";

/**
 * Compose the flushes run when a native window close is intercepted: pending
 * settings first (a failed settings write never blocks the close), then dirty
 * documents, whose result decides whether the window may close.
 */
export function useCloseFlush(flushDocuments: () => Promise<boolean>) {
  const { flushSettings } = useSettings();
  return useCallback(async () => {
    await flushSettings();
    return flushDocuments();
  }, [flushSettings, flushDocuments]);
}
