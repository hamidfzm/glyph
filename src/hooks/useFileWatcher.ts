import { useEffect, useRef } from "react";
import { subscribe } from "@/lib/tauriEvent";

export function useFileWatcher(onFileChanged: () => void) {
  const callbackRef = useRef(onFileChanged);
  callbackRef.current = onFileChanged;

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;

    const unsubscribe = subscribe("file-changed", () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        callbackRef.current();
      }, 300);
    });

    return () => {
      clearTimeout(timeout);
      unsubscribe();
    };
  }, []);
}
