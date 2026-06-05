import { useCallback, useEffect, useRef, useState } from "react";

/** How long a refusal notice stays up before auto-dismissing. */
const AUTO_DISMISS_MS = 6000;

/**
 * Transient one-line notice shown when a folder is refused as a workspace
 * (nested git repo / overlapping workspace, see #262). There's no toast system
 * in the app, so this is the lightest surface: a single message that
 * auto-dismisses after a few seconds and can be closed manually.
 */
export function useWorkspaceNotice() {
  const [notice, setNotice] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    clearTimer();
    setNotice(null);
  }, [clearTimer]);

  const show = useCallback(
    (message: string) => {
      clearTimer();
      setNotice(message);
      timerRef.current = setTimeout(() => setNotice(null), AUTO_DISMISS_MS);
    },
    [clearTimer],
  );

  // Clear any pending timer on unmount so it can't fire into a dead component.
  useEffect(() => clearTimer, [clearTimer]);

  return { notice, show, dismiss };
}
