import { useCallback, useEffect, useRef, useState } from "react";

/** How long a transient notice stays up before auto-dismissing. */
const AUTO_DISMISS_MS = 6000;

/**
 * One-line notice surfacing a workspace event (see #262). There's no toast
 * system in the app, so this is the lightest surface: a single message that can
 * always be closed manually. A refusal (folder rejected) auto-dismisses after a
 * few seconds; a `persistent` warning (e.g. a folder opened despite sitting
 * inside a parent git repo) stays up until the user dismisses it.
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
    (message: string, options?: { persistent?: boolean }) => {
      clearTimer();
      setNotice(message);
      if (!options?.persistent) {
        timerRef.current = setTimeout(() => setNotice(null), AUTO_DISMISS_MS);
      }
    },
    [clearTimer],
  );

  // Clear any pending timer on unmount so it can't fire into a dead component.
  useEffect(() => clearTimer, [clearTimer]);

  return { notice, show, dismiss };
}
