import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Bridges a plain async caller to a React modal: `confirm` shows the prompt for
 * `request` and resolves with the user's answer.
 *
 * Only one prompt is open at a time. A request arriving while one is pending
 * resolves `dismissed` rather than queueing, so a stacked operation aborts
 * instead of racing two dialogs over the same documents.
 */
export function usePrompt<Request, Answer>(dismissed: Answer) {
  const [request, setRequest] = useState<Request | null>(null);
  const resolveRef = useRef<((answer: Answer) => void) | null>(null);

  const confirm = useCallback(
    (next: Request): Promise<Answer> => {
      if (resolveRef.current) return Promise.resolve(dismissed);
      return new Promise<Answer>((resolve) => {
        resolveRef.current = resolve;
        setRequest(next);
      });
    },
    [dismissed],
  );

  // An unmount with a prompt open (an error boundary swapping the tree out)
  // would otherwise leave the caller awaiting a promise that can never settle,
  // parking an intercepted window close forever (#530).
  useEffect(
    () => () => {
      resolveRef.current?.(dismissed);
      resolveRef.current = null;
    },
    [dismissed],
  );

  const choose = useCallback((answer: Answer) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setRequest(null);
    resolve?.(answer);
  }, []);

  return { request, confirm, choose };
}
