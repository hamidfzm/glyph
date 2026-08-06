import { useCallback, useEffect, useRef, useState } from "react";

/** What the user picked in the unsaved-changes prompt. */
export type UnsavedChoice = "save" | "discard" | "cancel";

/**
 * Bridges the close coordinator (a plain async function) to a React modal:
 * `confirm` shows the prompt for `paths` and resolves with the button pressed.
 *
 * Only one prompt is open at a time. A request arriving while one is pending
 * resolves `cancel` rather than queueing, so a stacked close aborts instead of
 * racing two dialogs over the same documents.
 */
export function useUnsavedChangesPrompt() {
  const [files, setFiles] = useState<string[] | null>(null);
  const resolveRef = useRef<((choice: UnsavedChoice) => void) | null>(null);

  const confirm = useCallback((paths: string[]): Promise<UnsavedChoice> => {
    if (resolveRef.current) return Promise.resolve("cancel");
    return new Promise<UnsavedChoice>((resolve) => {
      resolveRef.current = resolve;
      setFiles(paths);
    });
  }, []);

  // An unmount with a prompt open (an error boundary swapping the tree out)
  // would otherwise leave the close coordinator awaiting a promise that can
  // never settle, parking the intercepted window close forever (#530).
  useEffect(
    () => () => {
      resolveRef.current?.("cancel");
      resolveRef.current = null;
    },
    [],
  );

  const choose = useCallback((choice: UnsavedChoice) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setFiles(null);
    resolve?.(choice);
  }, []);

  return { files, confirm, choose };
}
